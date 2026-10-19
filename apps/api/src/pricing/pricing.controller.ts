import type { Quote } from '@lern/contracts';
import { Body, Controller, Post } from '@nestjs/common';
import { ZodSerializerDto } from 'nestjs-zod';
import { type AuthUser, CurrentUser, Roles } from '../auth/auth.decorators';
import { CreateQuoteDto } from './dto/create-quote.dto';
import { QuoteDto } from './dto/quote.dto';
import { PricingService } from './pricing.service';

@Controller('quotes')
export class PricingController {
  constructor(private readonly pricing: PricingService) {}

  @Post()
  @Roles('rider')
  @ZodSerializerDto(QuoteDto)
  create(@CurrentUser() user: AuthUser, @Body() body: CreateQuoteDto): Promise<Quote> {
    return this.pricing.quote(user.id, body);
  }
}
