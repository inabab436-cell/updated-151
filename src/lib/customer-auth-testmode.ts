/**
 * TEMPORARY test-mode switch for the CUSTOMER registration/login flow only.
 *
 * While `CUSTOMER_OTP_TEST_MODE` is true:
 *  - no verification email is sent for customer sign-in;
 *  - the OTP code is still generated + stored and verified normally, but it is
 *    returned to the client so the login panel can complete sign-in instantly;
 *  - the 60s resend cooldown / send-window limits are skipped.
 *
 * To re-enable real email verification: set this constant to `false`.
 * Nothing else in the OTP system (tables, rate limits, email templates,
 * merchant auth) is changed by this flag.
 */
export const CUSTOMER_OTP_TEST_MODE = true;
