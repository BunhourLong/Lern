import type { Quote } from '@lern/contracts';
import { Body, Controller, Post } from '@nestjs/common';
import { ZodSerializerDto } from 'nestjs-zod';
import { type AuthUser, CurrentUser, Roles } from '../auth/auth.decorators';
import { Idempotent } from '../shared/idempotency/idempotency.interceptor';
import { CreateQuoteDto } from './dto/create-quote.dto';
import { QuoteDto } from './dto/quote.dto';
import { PricingService } from './pricing.service';

@Controller('quotes')
export class PricingController {
  constructor(private readonly pricing: PricingService) {}

  @Post()
  @Roles('rider')
  @Idempotent()
  @ZodSerializerDto(QuoteDto)
  create(@CurrentUser() user: AuthUser, @Body() body: CreateQuoteDto): Promise<Quote> {
    return this.pricing.quote(user.id, body);
  }
}
