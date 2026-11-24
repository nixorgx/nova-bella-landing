/** Wrong current passwords are counted per user (not per IP): 5 tries every 15 minutes. */
export const MAX_PASSWORD_CHANGE_ATTEMPTS = 5;
export const passwordChangeKey = (userId: string): string => `pwchg|${userId}`;
