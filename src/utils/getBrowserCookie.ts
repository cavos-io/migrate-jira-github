import fetch, { Response, RequestInit } from "node-fetch";
import { JSDOM } from "jsdom";
import { load } from "cheerio";
import { TOTP } from "otpauth";
import { ghAuth } from "../config";

const USER_AGENT = "Mozilla/5.0";

// Cache the last cookie string
let cachedCookie: string | null = null;

interface FetchResult {
  res: Response;
  text: string;
}

/** Merge an array of Set-Cookie headers into our existing cookie jar string */
function mergeCookies(
  cookieJar: string,
  setCookieHeaders: string[] = []
): string {
  let jar = cookieJar;
  for (const header of setCookieHeaders) {
    const pair = header.split(";")[0]; // "name=value"
    const [name] = pair.split("=");
    const re = new RegExp(`${name}=[^;]+`);
    jar = re.test(jar) ? jar.replace(re, pair) : `${jar}; ${pair}`;
  }
  return jar;
}

/** Extract CSRF token from GitHub page HTML (hidden input or meta tag) */
function extractCsrfToken(html: string): string | null {
  const dom = new JSDOM(html).window.document;
  return (
    dom
      .querySelector('input[name="authenticity_token"]')
      ?.getAttribute("value") ||
    dom.querySelector('meta[name="csrf-token"]')?.getAttribute("content") ||
    null
  );
}

/** Perform a fetch without following redirects */
async function fetchNoRedirect(
  url: string,
  options: RequestInit = {}
): Promise<FetchResult> {
  const res = await fetch(url, { ...options, redirect: "manual" });
  const text = await res.text();
  return { res, text };
}

/** Handle the two-factor challenge: GET the 2FA form, generate TOTP, POST it */
async function doTwoFactor(
  cookieJar: string,
  twoFaLocation: string,
  twoFactorSecret: string
): Promise<string> {
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
  if (!token) {
    throw new Error("Could not find authenticity_token on 2FA page");
  }

  // 3) Generate TOTP code
  const totp = new TOTP({ secret: twoFactorSecret, digits: 6, period: 30 });
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

/**
 * Get a valid GitHub browser cookie string, handling login and 2FA as needed.
 * Results are cached for subsequent calls.
 */
export async function getGitHubBrowserCookie(): Promise<string> {
  if (cachedCookie) {
    return cachedCookie;
  }

  const { username, password, twoFactorSecret } = ghAuth;
  if (!username || !password) {
    throw new Error("GitHub credentials are not set in ghAuth");
  }

  // 1) GET the login page
  const { res: loginRes, text: loginHtml } = await fetchNoRedirect(
    "https://github.com/login",
    { headers: { "User-Agent": USER_AGENT } }
  );
  let cookieJar = mergeCookies("", loginRes.headers.raw()["set-cookie"]);

  // 2) Extract CSRF token
  const loginToken = extractCsrfToken(loginHtml);
  if (!loginToken) {
    throw new Error("No authenticity_token on login page");
  }

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

  // 4) If redirected to 2FA, handle it
  if (location.includes("/sessions/two-factor")) {
    if (!twoFactorSecret) {
      throw new Error("Two-factor secret missing for 2FA login");
    }
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
