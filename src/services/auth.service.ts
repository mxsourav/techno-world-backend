import bcrypt from 'bcrypt';
import { prisma } from '../config/database.js';
import { generateTokens } from '../utils/jwt.js';
import { loginSchema } from '../validators/auth.validator.js';
import { z } from 'zod';

export const login = async (data: z.infer<typeof loginSchema>) => {
  const { email, password } = data;

  const user = await prisma.user.findUnique({
    where: { email },
  });

  if (!user || !user.isActive) {
    throw new Error('Invalid credentials or inactive user');
  }

  const isPasswordValid = await bcrypt.compare(password, user.password);
  if (!isPasswordValid) {
    throw new Error('Invalid credentials');
  }

  const { accessToken, refreshToken } = generateTokens(user.id, user.role);

  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + 7);

  await prisma.session.create({
    data: {
      userId: user.id,
      refreshToken,
      expiresAt,
    },
  });

  const { password: _, ...userWithoutPassword } = user;

  return {
    user: userWithoutPassword,
    accessToken,
    refreshToken,
  };
};
