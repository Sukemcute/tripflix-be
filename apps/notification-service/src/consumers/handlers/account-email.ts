import {
  AccessEmailVerificationRequestedV1Schema,
  AccessPasswordResetRequestedV1Schema,
  AccessRegistrationAttemptedExistingV1Schema,
  AccessRegistrationCodeRequestedV1Schema,
  AccessSessionReuseDetectedV1Schema,
  AccessUserWelcomeEmailRequestedV1Schema,
} from '@tripflix/contracts';
import { buildEmailVerificationEmail } from '../../outapp/email-verification.email.js';
import { buildExistingAccountEmail } from '../../outapp/existing-account.email.js';
import type { EmailMessage, Mailer } from '../../outapp/mailer.js';
import { buildPasswordResetEmail } from '../../outapp/password-reset.email.js';
import { buildRegistrationCodeEmail } from '../../outapp/registration-code.email.js';
import { buildSessionReuseEmail } from '../../outapp/session-reuse.email.js';
import { buildWelcomeEmail } from '../../outapp/welcome.email.js';
import type { EventHandler } from './event-handler.js';

export function createAccountEmailHandlers(mailer: Mailer, webAppUrl: string): Record<string, EventHandler> {
  function send<T>(schema: { parse(value: unknown): T }, build: (payload: T) => EmailMessage): EventHandler {
    return async (event) => {
      await mailer.send(build(schema.parse(event.payload)));
      return true;
    };
  }

  return {
    'access.password_reset_requested.v1': send(AccessPasswordResetRequestedV1Schema, buildPasswordResetEmail),
    'access.registration_code_requested.v1': send(AccessRegistrationCodeRequestedV1Schema, buildRegistrationCodeEmail),
    'access.registration_attempted_existing.v1': send(AccessRegistrationAttemptedExistingV1Schema, (payload) =>
      buildExistingAccountEmail(payload, webAppUrl),
    ),
    'access.session_reuse_detected.v1': send(AccessSessionReuseDetectedV1Schema, (payload) =>
      buildSessionReuseEmail(payload, webAppUrl),
    ),
    'access.email_verification_requested.v1': send(AccessEmailVerificationRequestedV1Schema, buildEmailVerificationEmail),
    'access.user.welcome_email_requested.v1': send(AccessUserWelcomeEmailRequestedV1Schema, (payload) =>
      buildWelcomeEmail(payload, webAppUrl),
    ),
  };
}
