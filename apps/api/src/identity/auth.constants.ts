/** Session and token settings decided in ADR-0006. */

/** Access tokens are verified without a database lookup, so this is how long a revoked session's last token stays usable. */
export const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;

/** Both the issuer and the only audience of Costly's access tokens. */
export const TOKEN_ISSUER = 'costly-api';
export const TOKEN_AUDIENCE = 'costly-api';

/** Absolute session lifetime: rotated tokens inherit the expiry set at login. */
export const REFRESH_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export const REFRESH_COOKIE_NAME = 'costly_refresh';
/** The cookie is only sent to the endpoints that read it. */
export const REFRESH_COOKIE_PATH = '/auth';
