import fetch, { Response, RequestInit } from "node-fetch";
import { JSDOM } from "jsdom";
import { load } from "cheerio";
import { TOTP, Secret } from "otpauth";
import { ghAuth } from "../config";

// GitHub endpoints and headers
const GITHUB_LOGIN_URL = "https://github.com/login";
const GITHUB_SESSION_URL = "https://github.com/session";
const GITHUB_2FA_URL = "https://github.com/sessions/two-factor";
const USER_AGENT = "Mozilla/5.0";

// Cache the authenticated cookie string
let cachedCookie: string | null = null;

interface FetchResult {
  res: Response;
  text: string;
}

/**
 * Merge new Set-Cookie headers into an existing cookie jar string
 */
function mergeCookies(jar: string, setCookie: string[] = []): string {
  return setCookie.reduce((cookieJar, header) => {
    const pair = header.split(";")[0];
    const [name] = pair.split("=");
    const regex = new RegExp(`${name}=[^;]+`);
    return regex.test(cookieJar)
      ? cookieJar.replace(regex, pair)
      : `${cookieJar}; ${pair}`;
  }, jar);
}

/**
 * Extract the CSRF authenticity token from HTML
 */
function extractCsrfToken(html: string): string {
  const document = new JSDOM(html).window.document;
  const input = document
    .querySelector('input[name="authenticity_token"]')
    ?.getAttribute("value");
  const meta = document
    .querySelector('meta[name="csrf-token"]')
    ?.getAttribute("content");
  if (!input && !meta) {
    throw new Error("CSRF token not found in HTML");
  }
  return input || meta!;
}

/**
 * Perform a fetch without following redirects, returning both response and body text
 */
async function fetchNoRedirect(
  url: string,
  options: RequestInit = {}
): Promise<FetchResult> {
  const res = await fetch(url, {
    ...options,
    redirect: "manual",
    headers: { "User-Agent": USER_AGENT, ...options.headers },
  });
  const text = await res.text();
  return { res, text };
}

/**
 * Handle the GitHub 2FA flow by trying a sliding window of OTP codes
 */
async function handleTwoFactor(
  cookieJar: string,
  twoFaLocation: string,
  secret: string
): Promise<string> {
  const url = twoFaLocation.startsWith("http")
    ? twoFaLocation
    : new URL(twoFaLocation, "https://github.com").href;

  // Fetch 2FA form
  const { res: getRes, text: getHtml } = await fetchNoRedirect(url, {
    headers: { Cookie: cookieJar, Referer: GITHUB_SESSION_URL },
  });
  cookieJar = mergeCookies(cookieJar, getRes.headers.raw()["set-cookie"]);

  const csrfToken = extractCsrfToken(getHtml);

  // Prepare TOTP generator
  const totp = new TOTP({
    secret: Secret.fromBase32(secret.trim()),
    digits: 6,
    period: 30,
    algorithm: "SHA1",
  });

  // Try codes for [prev, now, next] 30-second windows
  const step = totp.period * 1000;
  const timestamps = [Date.now() - step, Date.now(), Date.now() + step];

  for (const ts of timestamps) {
    const otp = totp.generate({ timestamp: ts });
    const form = new URLSearchParams({ authenticity_token: csrfToken, otp });
    const { res: postRes, text: postHtml } = await fetchNoRedirect(
      GITHUB_2FA_URL,
      {
        method: "POST",
        headers: {
          Cookie: cookieJar,
          Referer: url,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: form,
      }
    );
    cookieJar = mergeCookies(cookieJar, postRes.headers.raw()["set-cookie"]);
    if (postRes.status === 302) {
      return cookieJar;
    }
    // else continue to next candidate
  }

  // If we reach here, all attempts failed
  const $ = load((await fetchNoRedirect(GITHUB_2FA_URL)).text);
  throw new Error(`2FA failed: ${$(".flash-error").text().trim()}`);
}

/**
 * Obtain a valid GitHub session cookie, performing login and 2FA as needed.
 */
export async function getGitHubBrowserCookie(): Promise<string> {
  if (cachedCookie) return cachedCookie;

  const { username, password, twoFactorSecret } = ghAuth;
  if (!username || !password) {
    throw new Error("GH_USER and GH_PASSWORD must be set in environment");
  }

  // Step 1: GET login page
  const { res: loginRes, text: loginHtml } =
    await fetchNoRedirect(GITHUB_LOGIN_URL);
  let cookieJar = mergeCookies("", loginRes.headers.raw()["set-cookie"]);

  // Step 2: POST credentials
  const loginToken = extractCsrfToken(loginHtml);
  const loginForm = new URLSearchParams({
    login: username,
    password,
    authenticity_token: loginToken,
    commit: "Sign in",
  });
  const { res: postRes, text: postHtml } = await fetchNoRedirect(
    GITHUB_SESSION_URL,
    {
      method: "POST",
      headers: {
        Cookie: cookieJar,
        Referer: GITHUB_LOGIN_URL,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: loginForm,
    }
  );
  cookieJar = mergeCookies(cookieJar, postRes.headers.raw()["set-cookie"]);

  const location = postRes.headers.get("location") || "";
  if (location.includes("/sessions/two-factor")) {
    if (!twoFactorSecret) {
      throw new Error(
        "GH_2FA_SECRET must be set for two-factor authentication"
      );
    }
    cookieJar = await handleTwoFactor(cookieJar, location, twoFactorSecret);
  } else if (postRes.status !== 302) {
    const $ = load(postHtml);
    throw new Error(`Login failed: ${$(".flash-error").text().trim()}`);
  }

  cachedCookie = cookieJar;
  return cookieJar;
}
