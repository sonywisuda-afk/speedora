import { IsEmail, IsOptional, IsString, MinLength } from 'class-validator';

export class LoginDto {
  @IsEmail()
  email: string;

  @IsString()
  @MinLength(8)
  password: string;

  // Authentication Foundation Sprint 4 (Attack Protection) - present only
  // once the client has rendered Turnstile and solved it, in response to a
  // prior login attempt's requiresCaptcha:true. Absent on every normal
  // (low-risk) login.
  @IsOptional()
  @IsString()
  captchaToken?: string;
}
