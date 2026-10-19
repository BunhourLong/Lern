import type { Health } from '@lern/contracts';
import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { ZodSerializerDto } from 'nestjs-zod';
import { HealthDto } from './dto/health.dto';
import { HealthService } from './health.service';

@Controller('health')
export class HealthController {
  constructor(private readonly health: HealthService) {}

  @Get()
  @ZodSerializerDto(HealthDto)
  async check(): Promise<Health> {
    const result = await this.health.check();
    if (result.status === 'error') throw new ServiceUnavailableException(result);
    return result;
  }
}
