// Second factor for staff logins (PLAN.md M7). begin() runs after the password checks out: 'approved' means the
// session starts now, 'redirect' sends the browser to the provider with `state`, and no session exists until
// complete() accepts the code the provider sent back.
export abstract class StaffMfaProvider {
  abstract begin(
    staff: { id: string; email: string },
    state: string,
  ): Promise<{ status: 'approved' } | { status: 'redirect'; redirectUrl: string }>;

  abstract complete(code: string, expectedEmail: string): Promise<boolean>;
}
