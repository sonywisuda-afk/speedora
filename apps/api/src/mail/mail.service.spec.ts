const sendMailMock = jest.fn();
const createTransportMock = jest.fn().mockReturnValue({ sendMail: sendMailMock });
jest.mock('nodemailer', () => ({
  createTransport: (...args: unknown[]) => createTransportMock(...args),
}));

describe('MailService', () => {
  const ORIGINAL_ENV = process.env;

  // Re-imported fresh in every test (not statically at the top of the file)
  // so each test gets its own module-scope `transporter` singleton - reusing
  // the same import across tests would mean only the first test to trigger
  // getTransporter() actually observes createTransport()'s arguments.
  async function freshMailService() {
    jest.resetModules();
    const { MailService } = await import('./mail.service');
    return new MailService();
  }

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = { ...ORIGINAL_ENV };
  });

  afterAll(() => {
    process.env = ORIGINAL_ENV;
  });

  it('logs the reset link instead of sending when SMTP_HOST is not configured', async () => {
    delete process.env.SMTP_HOST;
    const service = await freshMailService();
    const warnSpy = jest.spyOn((service as any).logger, 'warn').mockImplementation();

    await service.sendPasswordResetEmail(
      'user@example.com',
      'https://app.test/reset-password?token=abc',
    );

    expect(sendMailMock).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('https://app.test/reset-password?token=abc'),
    );
  });

  it('sends a real email via nodemailer when SMTP_HOST is configured', async () => {
    process.env.SMTP_HOST = 'smtp.example.com';
    process.env.SMTP_PORT = '2525';
    process.env.SMTP_USER = 'user';
    process.env.SMTP_PASSWORD = 'pass';
    process.env.SMTP_FROM = 'no-reply@example.com';
    const service = await freshMailService();

    await service.sendPasswordResetEmail(
      'user@example.com',
      'https://app.test/reset-password?token=abc',
    );

    expect(sendMailMock).toHaveBeenCalledWith(
      expect.objectContaining({
        from: 'no-reply@example.com',
        to: 'user@example.com',
        subject: expect.any(String),
        text: expect.stringContaining('https://app.test/reset-password?token=abc'),
        html: expect.stringContaining('https://app.test/reset-password?token=abc'),
      }),
    );
  });

  it('strips whitespace from SMTP_PASSWORD (Gmail App Passwords display with spaces)', async () => {
    process.env.SMTP_HOST = 'smtp.gmail.com';
    process.env.SMTP_USER = 'user@gmail.com';
    process.env.SMTP_PASSWORD = 'abcd efgh ijkl mnop';
    const service = await freshMailService();

    await service.sendPasswordResetEmail('user@example.com', 'https://app.test/reset-password');

    expect(createTransportMock).toHaveBeenCalledWith(
      expect.objectContaining({
        auth: { user: 'user@gmail.com', pass: 'abcdefghijklmnop' },
      }),
    );
  });

  it('logs and does not throw when the SMTP send itself fails', async () => {
    process.env.SMTP_HOST = 'smtp.example.com';
    process.env.SMTP_USER = 'user';
    process.env.SMTP_PASSWORD = 'pass';
    sendMailMock.mockRejectedValueOnce(
      new Error('Invalid login: 535 Username and Password not accepted'),
    );
    const service = await freshMailService();
    const errorSpy = jest.spyOn((service as any).logger, 'error').mockImplementation();

    await expect(
      service.sendPasswordResetEmail('user@example.com', 'https://app.test/reset-password'),
    ).resolves.toBeUndefined();

    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Invalid login'));
  });
});
