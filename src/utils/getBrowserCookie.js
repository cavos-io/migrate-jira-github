import fetch from "node-fetch";
import { JSDOM } from "jsdom";
import { load } from "cheerio";
import { TOTP } from "otpauth";
import { ghAuth } from "../config.js";

const USER_AGENT = "Mozilla/5.0";

let cachedCookie = null;

/** Merge an array of Set-Cookie headers into our existing cookie jar string */
function mergeCookies(cookieJar, setCookieHeaders = []) {
  setCookieHeaders.forEach((c) => {
    const pair = c.split(";")[0];
    const name = pair.split("=")[0];
    const re = new RegExp(`${name}=[^;]+`);
    cookieJar = cookieJar.match(re)
      ? cookieJar.replace(re, pair)
      : `${cookieJar}; ${pair}`;
  });
  return cookieJar;
}

/** Extract CSRF token from GitHub page HTML (hidden input or meta tag) */
function extractCsrfToken(html) {
  const dom = new JSDOM(html).window.document;
  return (
    dom.querySelector('input[name="authenticity_token"]')?.value ||
    dom.querySelector('meta[name="csrf-token"]')?.getAttribute("content") ||
    null
  );
}

/** Perform a fetch without following redirects */
async function fetchNoRedirect(url, options = {}) {
  const res = await fetch(url, { ...options, redirect: "manual" });
  const text = await res.text();
  return { res, text };
}

/** Handle the two-factor challenge: GET the 2FA form, generate TOTP, POST it */
async function doTwoFactor(cookieJar, twoFaLocation, twoFactorSecret) {
  const twoFaUrl = twoFaLocation.startsWith("http")
    ? twoFaLocation
    : `https://github.com${twoFaLocation}`;

  // 1) GET the 2FA page
  const { res: twoFaRes, text: twoFaHtml } = await fetchNoRedirect(twoFaUrl, {
    headers: {
      "User-Agent": USER_AGENT,
      Cookie: cookieJar,
      Referer: "https://github.com/session",
    },
  });
  cookieJar = mergeCookies(cookieJar, twoFaRes.headers.raw()["set-cookie"]);

  // 2) Extract CSRF token
  const token = extractCsrfToken(twoFaHtml);
  if (!token) throw new Error("Could not find authenticity_token on 2FA page");

  // 3) Generate TOTP code
  const totp = new TOTP({ secret: twoFactorSecret, digits: 6, step: 30 });
  const otp = totp.generate();

  // 4) POST the OTP
  const form = new URLSearchParams({ authenticity_token: token, otp });
  const { res: otpRes, text: otpHtml } = await fetchNoRedirect(
    "https://github.com/sessions/two-factor",
    {
      method: "POST",
      headers: {
        "User-Agent": USER_AGENT,
        "Content-Type": "application/x-www-form-urlencoded",
        Cookie: cookieJar,
        Referer: twoFaUrl,
      },
      body: form,
    }
  );
  cookieJar = mergeCookies(cookieJar, otpRes.headers.raw()["set-cookie"]);

  if (otpRes.status !== 302) {
    const $ = load(otpHtml);
    throw new Error(`2FA failed: ${$(".flash-error").text().trim()}`);
  }

  return cookieJar;
}

export async function getGitHubBrowserCookie() {
  if (cachedCookie) return cachedCookie;

  const { username, password, twoFactorSecret } = ghAuth;

  // 1) GET the login page
  const { res: loginRes, text: loginHtml } = await fetchNoRedirect(
    "https://github.com/login",
    { headers: { "User-Agent": USER_AGENT } }
  );
  let cookieJar = mergeCookies("", loginRes.headers.raw()["set-cookie"]);

  // 2) Extract CSRF token
  const loginToken = extractCsrfToken(loginHtml);
  if (!loginToken) throw new Error("No authenticity_token on login page");

  // 3) POST credentials
  const form = new URLSearchParams({
    login: username,
    password,
    authenticity_token: loginToken,
    commit: "Sign in",
  });
  const { res: postRes, text: postHtml } = await fetchNoRedirect(
    "https://github.com/session",
    {
      method: "POST",
      headers: {
        "User-Agent": USER_AGENT,
        "Content-Type": "application/x-www-form-urlencoded",
        Cookie: cookieJar,
        Referer: "https://github.com/login",
      },
      body: form,
    }
  );
  cookieJar = mergeCookies(cookieJar, postRes.headers.raw()["set-cookie"]);

  const location = postRes.headers.get("location") || "";

  // 4) If we’re redirected to 2FA, handle it
  if (location.includes("/sessions/two-factor")) {
    cookieJar = await doTwoFactor(cookieJar, location, twoFactorSecret);
  }
  // 5) Otherwise, check for login failure
  else if (postRes.status !== 302) {
    const $ = load(postHtml);
    throw new Error(`Login failed: ${$(".flash-error").text().trim()}`);
  }

  // 6) Success—cache and return
  cachedCookie = cookieJar;
  return cookieJar;
}
