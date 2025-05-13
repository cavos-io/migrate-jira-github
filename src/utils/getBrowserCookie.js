import fetch from "node-fetch";
import { JSDOM } from "jsdom";
import { load } from "cheerio";
import { ghAuth } from "../config.js";

let cachedCookie = null;

export async function getGitHubBrowserCookie() {
  if (cachedCookie) return cachedCookie;

  const { username, password } = ghAuth;

  // 1) Fetch the login page to grab initial cookies and authenticity_token
  const loginRes = await fetch("https://github.com/login", {
    headers: { "User-Agent": "Mozilla/5.0" },
  });
  const loginHtml = await loginRes.text();

  // Build our cookie jar from Set-Cookie headers
  let cookieJar = (loginRes.headers.raw()["set-cookie"] || [])
    .map((c) => c.split(";")[0])
    .join("; ");

  // Parse the authenticity_token using jsdom
  const dom = new JSDOM(loginHtml);
  const tokenEl = dom.window.document.querySelector(
    'input[name="authenticity_token"]'
  );
  if (!tokenEl) {
    throw new Error("Could not find authenticity_token on login page");
  }
  const authenticityToken = tokenEl.value;

  // 2) Prepare form data for POST /session
  const form = new URLSearchParams();
  form.append("login", username);
  form.append("password", password);
  form.append("authenticity_token", authenticityToken);
  form.append("commit", "Sign in");

  // 3) Submit credentials
  const postRes = await fetch("https://github.com/session", {
    method: "POST",
    headers: {
      "User-Agent": "Mozilla/5.0",
      "Content-Type": "application/x-www-form-urlencoded",
      Cookie: cookieJar,
      Referer: "https://github.com/login",
    },
    body: form,
    redirect: "manual",
  });

  // Update cookie jar with any new Set-Cookie headers
  (postRes.headers.raw()["set-cookie"] || []).forEach((c) => {
    const [pair] = c.split(";");
    const [name] = pair.split("=");
    const re = new RegExp(`${name}=[^;]+`);
    cookieJar = cookieJar.match(re)
      ? cookieJar.replace(re, pair)
      : `${cookieJar}; ${pair}`;
  });

  // 4) Detect login success via redirect (302)
  if (postRes.status !== 302) {
    // Parse error message with cheerio
    const errHtml = await postRes.text();
    const $ = load(errHtml);
    const flash = $(".flash-error").text().trim();
    throw new Error(`GitHub login failed: ${flash || "no redirect"}`);
  }

  // 5) Cache and return the cookie string
  cachedCookie = cookieJar;
  return cachedCookie;
}
