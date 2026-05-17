import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { JwtStrategy } from './jwt.strategy';
import { MfaService } from './mfa.service';
import { DeviceBindingService } from './device-binding.service';

@Module({
  imports: [
    ConfigModule,
    PassportModule.register({ defaultStrategy: 'jwt', session: false }),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => ({
        secret: configService.get<string>('security.jwt.secret'),
        signOptions: {
          expiresIn: configService.get<string>('security.jwt.accessTokenExpiresIn', '15m'),
          issuer: configService.get<string>('security.jwt.issuer', 'ghana-sl-backoffice'),
          audience: configService.get<string>('security.jwt.audience', 'ghana-sl-api'),
          algorithm: configService.get<string>('security.jwt.algorithm', 'HS256') as 'HS256',
        },
      }),
      inject: [ConfigService],
    }),
    ThrottlerModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => ({
        throttlers: [
          {
            name: 'auth',
            ttl: configService.get<number>('security.rateLimit.auth.ttl', 60000),
            limit: configService.get<number>('security.rateLimit.auth.limit', 20),
          },
          {
            name: 'mfa',
            ttl: configService.get<number>('security.rateLimit.mfa.ttl', 300000),
            limit: configService.get<number>('security.rateLimit.mfa.limit', 10),
          },
        ],
      }),
      inject: [ConfigService],
    }),
  ],
  providers: [JwtStrategy, MfaService, DeviceBindingService],
  exports: [JwtModule, PassportModule, MfaService, DeviceBindingService],
})
export class AuthModule {}
