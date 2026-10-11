// Shared by the rating form (client) and the server code: plain values,
// no server-only imports.
export const RATING_COMMENT_MAX_LENGTH = 500;

// Fewer ratings than this and a per-person CSAT isn't shown: one unhappy
// customer shouldn't define someone's score.
export const MIN_RATINGS_FOR_CSAT = 3;
