/**
 * IndexNow Service — Real-time search engine URL notification engine
 * 
 * Complies with the IndexNow protocol specification (indexnow.org).
 * Notifies Bing, Yandex, Seznam, Naver, and other participating search engines
 * instantly whenever books, categories, or blog posts are published or updated.
 */

import axios from 'axios';

const HOST = 'technoworldbooks.in';
const BASE_URL = `https://${HOST}`;
export const INDEXNOW_KEY = process.env.INDEXNOW_KEY || 'c8f1a4e72d0b49c693a17e54f0689b2d';
const KEY_LOCATION = `${BASE_URL}/${INDEXNOW_KEY}.txt`;
const INDEXNOW_ENDPOINT = 'https://api.indexnow.org/indexnow';

export interface IndexNowResult {
  success: boolean;
  statusCode?: number;
  message: string;
  submittedCount: number;
}

/**
 * Normalizes input URL(s) to absolute URLs on the production domain.
 */
function normalizeUrl(url: string): string {
  if (url.startsWith('http://') || url.startsWith('https://')) {
    return url;
  }
  const cleanPath = url.startsWith('/') ? url : `/${url}`;
  return `${BASE_URL}${cleanPath}`;
}

/**
 * Submits one or more URLs to IndexNow.
 *
 * @param urls Single URL string or array of URL strings (relative or absolute).
 * @returns Object indicating success status and HTTP response details.
 */
export async function submitToIndexNow(urls: string | string[]): Promise<IndexNowResult> {
  try {
    const rawList = Array.isArray(urls) ? urls : [urls];
    // Deduplicate and ensure full canonical URLs
    const urlList = Array.from(
      new Set(rawList.map(normalizeUrl).filter((u) => u.startsWith(BASE_URL)))
    );

    if (urlList.length === 0) {
      return {
        success: true,
        message: 'No valid URLs to submit.',
        submittedCount: 0,
      };
    }

    const payload = {
      host: HOST,
      key: INDEXNOW_KEY,
      keyLocation: KEY_LOCATION,
      urlList,
    };

    const response = await axios.post(INDEXNOW_ENDPOINT, payload, {
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
      },
      timeout: 10000,
      // Consider 200, 202 as successful
      validateStatus: (status) => status < 500,
    });

    if (response.status === 200 || response.status === 202) {
      console.log(`[IndexNow] Successfully submitted ${urlList.length} URL(s) (HTTP ${response.status})`);
      return {
        success: true,
        statusCode: response.status,
        message: `Submitted ${urlList.length} URL(s) to IndexNow.`,
        submittedCount: urlList.length,
      };
    }

    if (response.status === 429) {
      console.warn('[IndexNow] Rate limited by IndexNow API (HTTP 429).');
      return {
        success: false,
        statusCode: 429,
        message: 'Rate limited by IndexNow API.',
        submittedCount: 0,
      };
    }

    console.warn(`[IndexNow] Submission returned HTTP ${response.status}:`, response.data);
    return {
      success: false,
      statusCode: response.status,
      message: `IndexNow returned status ${response.status}`,
      submittedCount: 0,
    };
  } catch (error: any) {
    console.error('[IndexNow] Submission failed with error:', error?.message || error);
    return {
      success: false,
      message: error?.message || 'Unknown network error during IndexNow submission.',
      submittedCount: 0,
    };
  }
}

/**
 * Convenience helper to submit a single newly published/updated book.
 */
export async function notifyBookUpdated(slug: string): Promise<IndexNowResult> {
  return submitToIndexNow([`/book/${slug}`, '/']);
}

/**
 * Convenience helper to submit a blog post.
 */
export async function notifyBlogUpdated(slug: string): Promise<IndexNowResult> {
  return submitToIndexNow([`/blog/${slug}`, '/blog']);
}

/**
 * Convenience helper to submit a category page.
 */
export async function notifyCategoryUpdated(slug: string): Promise<IndexNowResult> {
  return submitToIndexNow([`/category/${slug}`, '/']);
}
