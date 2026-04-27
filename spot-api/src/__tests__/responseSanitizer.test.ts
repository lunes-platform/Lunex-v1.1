import type { Request, Response } from 'express';
import { responseSanitizer } from '../middleware/responseSanitizer';

describe('responseSanitizer', () => {
  function runMiddleware({
    body,
    isProduction,
    statusCode,
  }: {
    body: unknown;
    isProduction: boolean;
    statusCode: number;
  }) {
    const originalJson = jest.fn();
    const res = {
      statusCode,
      json: originalJson,
    } as unknown as Response;
    const next = jest.fn();

    responseSanitizer({ isProduction })({} as Request, res, next);
    (res.json as unknown as jest.Mock)(body);

    expect(next).toHaveBeenCalledTimes(1);
    return originalJson.mock.calls[0]?.[0];
  }

  it('removes internal error details from production error responses', () => {
    const responseBody = runMiddleware({
      isProduction: true,
      statusCode: 400,
      body: {
        error: 'Validation failed',
        code: 'BAD_REQUEST',
        details: [{ path: ['secretField'], message: 'Required' }],
        stack: 'internal stack',
        trace: 'internal trace',
      },
    });

    expect(responseBody).toEqual({
      error: 'Validation failed',
      code: 'BAD_REQUEST',
    });
  });

  it('preserves validation details outside production', () => {
    const responseBody = runMiddleware({
      isProduction: false,
      statusCode: 400,
      body: {
        error: 'Validation failed',
        details: [{ path: ['field'], message: 'Required' }],
      },
    });

    expect(responseBody.details).toHaveLength(1);
  });

  it('does not alter successful API responses', () => {
    const responseBody = runMiddleware({
      isProduction: true,
      statusCode: 200,
      body: { details: { publicMetadata: true } },
    });

    expect(responseBody).toEqual({ details: { publicMetadata: true } });
  });
});
