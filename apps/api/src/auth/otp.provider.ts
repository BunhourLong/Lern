// Sends and checks codes, like hosted verify APIs do, so a provider can keep codes on its side.
// Abstract class rather than interface: Nest injects it by this token.
export abstract class OtpProvider {
  abstract send(phone: string): Promise<void>;
  abstract check(phone: string, code: string): Promise<boolean>;
}
