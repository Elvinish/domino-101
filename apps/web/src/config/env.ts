import { z } from 'zod';

const webEnvSchema = z.object({
  VITE_API_BASE_URL: z
    .url()
    .refine((value) => {
      if (!URL.canParse(value)) return false;
      const url = new URL(value);
      return (
        ['http:', 'https:'].includes(url.protocol) &&
        !url.username &&
        !url.password &&
        !url.search &&
        !url.hash
      );
    })
    .default('http://localhost:3001'),
});

export function parseWebEnv(input: Record<string, unknown>) {
  const result = webEnvSchema.safeParse(input);
  if (!result.success)
    throw new Error('Invalid web environment: VITE_API_BASE_URL');
  return result.data;
}
