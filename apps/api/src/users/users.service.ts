import { Injectable } from '@nestjs/common';
import type { User } from '@viral-clip-app/database';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  getOrCreate(email: string): Promise<User> {
    return this.prisma.user.upsert({
      where: { email },
      update: {},
      create: { email },
    });
  }
}
