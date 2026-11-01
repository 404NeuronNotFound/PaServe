import {
  Injectable,
  Logger,
  HttpException,
  ServiceUnavailableException,
  UnauthorizedException,
  BadRequestException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient } from '@supabase/supabase-js';
import { boundedFetch } from '../../common/http/request-context.js';

@Injectable()
export class IdentityService {
  private readonly logger = new Logger(IdentityService.name);
  constructor(private readonly config: ConfigService) {}

  private client() {
    const url = this.config.get<string>('SUPABASE_URL');
    const key =
      this.config.get<string>('SUPABASE_ANON_KEY') ||
      this.config.get<string>('SUPABASE_SERVICE_ROLE_KEY');
    if (!url || !key)
      throw new ServiceUnavailableException({
        code: 'IDENTITY_UNAVAILABLE',
        message: 'Account verification is temporarily unavailable.',
      });
    // Fresh, non-persistent Auth client per operation: a user session must never
    // replace credentials on PaServe's shared Supabase storage/admin clients.
    return createClient(url, key, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
      global: { fetch: boundedFetch },
    });
  }

  async sendCode(email: string) {
    const { error } = await this.client().auth.signInWithOtp({
      email,
      options: { shouldCreateUser: true },
    });
    if (error) {
      // Log only bounded categories/status, never email addresses, tokens or the
      // provider's free-form error message (which can contain private details).
      const reason =
        error.code === 'email_address_not_authorized'
          ? 'sender_restricted'
          : error.status === 429 ||
              [
                'over_email_send_rate_limit',
                'over_request_rate_limit',
              ].includes(error.code ?? '')
            ? 'rate_limited'
            : [
                  'email_provider_disabled',
                  'otp_disabled',
                  'signup_disabled',
                ].includes(error.code ?? '')
              ? 'signup_disabled'
              : 'delivery_failed';
      this.logger.warn({
        event: 'verification_email_failed',
        provider: 'supabase-auth',
        reason,
        status:
          typeof error.status === 'number' &&
          Number.isInteger(error.status) &&
          error.status >= 400 &&
          error.status <= 599
            ? error.status
            : null,
      });
      if (reason === 'rate_limited')
        throw new HttpException(
          {
            code: 'EMAIL_RATE_LIMITED',
            message:
              'Verification email requests have reached the sending limit. Please wait before requesting another code.',
          },
          429,
        );
      if (reason === 'sender_restricted')
        throw new ServiceUnavailableException({
          code: 'EMAIL_DELIVERY_NOT_CONFIGURED',
          message:
            'Email sign-up is unavailable because verification email delivery has not been configured. Please contact support.',
        });
      if (reason === 'signup_disabled')
        throw new ServiceUnavailableException({
          code: 'EMAIL_SIGNUP_DISABLED',
          message:
            'Email sign-up is currently disabled. Please contact support.',
        });
      throw new ServiceUnavailableException({
        code: 'EMAIL_UNAVAILABLE',
        message:
          'We could not send your verification code. Please wait and try again.',
      });
    }
    return {
      message: 'Check your inbox for your email verification code.',
    };
  }

  async sendRecoveryCode(email: string) {
    const { error } = await this.client().auth.resetPasswordForEmail(email);
    if (error) {
      if (error.status === 429)
        throw new HttpException(
          {
            code: 'EMAIL_RATE_LIMITED',
            message: 'Please wait before requesting another reset code.',
          },
          429,
        );
      // Do not disclose whether an address belongs to a Supabase or PaServe account.
      if (!['user_not_found', 'email_not_found'].includes(error.code ?? '')) {
        this.logger.warn({
          event: 'password_recovery_email_failed',
          provider: 'supabase-auth',
          reason: 'delivery_failed',
        });
        throw new ServiceUnavailableException({
          code: 'EMAIL_UNAVAILABLE',
          message:
            'Password recovery email is temporarily unavailable. Please try again shortly.',
        });
      }
    }
    return {
      message:
        'If this email has a password account, you will receive a reset code. Check your inbox and spam folder.',
    };
  }

  async verifyRecoveryCode(email: string, token: string) {
    const { data, error } = await this.client().auth.verifyOtp({
      email,
      token,
      type: 'recovery',
    });
    if (
      error ||
      !data.user?.email_confirmed_at ||
      data.user.email?.toLowerCase() !== email
    ) {
      throw new BadRequestException({
        code: 'INVALID_RECOVERY_CODE',
        message:
          'The reset code is invalid, expired, or already used. Request a new code and try again.',
      });
    }
  }

  async verifyEmail(email: string, token: string) {
    const { data, error } = await this.client().auth.verifyOtp({
      email,
      token,
      type: 'email',
    });
    if (
      error ||
      !data.user?.email_confirmed_at ||
      data.user.email?.toLowerCase() !== email
    ) {
      throw new BadRequestException({
        code: 'INVALID_VERIFICATION_CODE',
        message:
          'The code is incorrect, expired, or already used. Request a new code and try again.',
      });
    }
  }

  async verifyGoogle(credential: string, nonce: string | undefined) {
    if (!nonce || !/^[a-f0-9]{64}$/u.test(nonce))
      throw new UnauthorizedException({
        code: 'INVALID_GOOGLE_NONCE',
        message: 'Restart Google sign-in and try again.',
      });
    const { data, error } = await this.client().auth.signInWithIdToken({
      provider: 'google',
      token: credential,
      nonce,
    });
    const identity = data.user?.identities?.find(
      (item) => item.provider === 'google',
    );
    const claims = identity?.identity_data;
    const email =
      typeof claims?.email === 'string'
        ? claims.email.toLowerCase()
        : undefined;
    if (
      error ||
      !data.user?.email_confirmed_at ||
      typeof claims?.sub !== 'string' ||
      claims.email_verified !== true ||
      !email ||
      (!email.endsWith('@gmail.com') && typeof claims.hd !== 'string')
    ) {
      throw new UnauthorizedException({
        code: 'INVALID_GOOGLE_IDENTITY',
        message:
          'Google could not verify your account. Use a verified Gmail or Google Workspace account.',
      });
    }
    return { subject: claims.sub, email };
  }
}
