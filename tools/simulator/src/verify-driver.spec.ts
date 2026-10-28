import { verifyDriver } from './verify-driver';

describe('verifyDriver', () => {
  it.each([
    'postgres://lern:lern@db.example.com:5432/lern',
    'postgres://lern:lern@10.0.0.5/lern',
    'not a url',
    // pg takes host/hostaddr from the query over the authority
    'postgres://lern:lern@localhost/lern?host=db.example.com',
    'postgres://lern:lern@127.0.0.1/lern?hostaddr=10.0.0.5',
    'postgres://lern:lern@localhost/lern?host=/var/run/postgresql',
  ])(
    'refuses %s before connecting',
    async (url) => {
      await expect(verifyDriver(url, '00000000-0000-4000-8000-000000000000')).rejects.toThrow(
        'refusing to verify drivers outside a local database',
      );
    },
  );
});
