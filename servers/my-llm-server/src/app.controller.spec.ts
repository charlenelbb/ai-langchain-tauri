import { Test, TestingModule } from '@nestjs/testing';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { SseStreamService } from './sse/sse-stream.service';
import { CsService } from './cs/cs.service';

jest.mock('./cs/cs.service', () => ({ CsService: class CsService {} }));
jest.mock('./sse/sse-stream.service', () => ({ SseStreamService: class SseStreamService {} }));

describe('AppController', () => {
  let appController: AppController;

  beforeEach(async () => {
    const app: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [
        { provide: AppService, useValue: { getHello: () => 'Hello World!' } },
        { provide: SseStreamService, useValue: { handleStream: jest.fn() } },
        { provide: CsService, useValue: { assertCanAccessSession: jest.fn() } },
      ],
    }).compile();

    appController = app.get<AppController>(AppController);
  });

  describe('root', () => {
    it('should return "Hello World!"', () => {
      expect(appController.getHello()).toBe('Hello World!');
    });
  });
});
