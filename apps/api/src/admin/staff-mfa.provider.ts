// Second factor for staff logins (PLAN.md M7). begin() runs after the password checks out: 'approved' means the
// session starts now, 'redirect' sends the browser to the provider and no session exists until complete() succeeds.
export abstract class StaffMfaProvider {
  abstract begin(
    staff: { id: string; email: string },
  ): Promise<{ status: 'approved' } | { status: 'redirect'; redirectUrl: string; state: string }>;

  abstract complete(state: string, code: string, expectedEmail: string): Promise<boolean>;
}
