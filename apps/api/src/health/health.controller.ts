import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { type Health, HealthService } from './health.service';

@Controller('health')
export class HealthController {
  constructor(private readonly health: HealthService) {}

  @Get()
  async check(): Promise<Health> {
    const result = await this.health.check();
    if (result.status === 'error') throw new ServiceUnavailableException(result);
    return result;
  }
}
