import { Body, Controller, Get, Post } from '@nestjs/common';
import { AuthService } from './auth.service';
import { Public } from './roles.decorator';
import { CurrentUser } from './current-user.decorator';
import type { AuthUser } from './auth.types';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Post('login')
  async login(
    @Body('username') username?: string,
    @Body('password') password?: string,
  ) {
    return this.authService.login(username || '', password || '');
  }

  @Get('me')
  me(@CurrentUser() user: AuthUser) {
    return { user };
  }
}
