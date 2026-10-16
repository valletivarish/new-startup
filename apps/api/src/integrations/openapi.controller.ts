/** GET /v1/openapi.json: the API description, public so tooling can fetch it without a key. */

import { Controller, Get } from '@nestjs/common';

import { Public } from '../authz/decorators.js';
import { buildOpenApi } from './openapi.js';

const DOC = buildOpenApi();

@Controller('v1')
export class OpenApiController {
  @Public()
  @Get('openapi.json')
  get() {
    return DOC;
  }
}
