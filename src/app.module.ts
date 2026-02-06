import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import configuration from './config/configuration';
import { configValidationSchema } from './config/validation.schema';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { GradingModule } from './grading/grading.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
      validationSchema: configValidationSchema,
    }),
    GradingModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
