import type { FastifyReply, FastifyRequest } from 'fastify';
import { env, type Env } from '../env.js';

const READ_ONLY_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export function isReadOnlyProfile(profile: Env['TRACE_DEPLOYMENT_PROFILE']): boolean {
  return profile !== 'self_hosted';
}

export function isRequestAllowed(
  profile: Env['TRACE_DEPLOYMENT_PROFILE'],
  method: string,
): boolean {
  return !isReadOnlyProfile(profile) || READ_ONLY_METHODS.has(method.toUpperCase());
}

/**
 * Public exposure profiles are protected at the API boundary, independently
 * of the web UI and reverse proxy. The reserved sandbox profile deliberately
 * remains read-only until its isolated workspace API is implemented.
 */
export async function enforceDeploymentProfile(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  if (!isReadOnlyProfile(env.TRACE_DEPLOYMENT_PROFILE)) return;

  reply.header('x-trace-deployment-profile', env.TRACE_DEPLOYMENT_PROFILE);

  if (!isRequestAllowed(env.TRACE_DEPLOYMENT_PROFILE, request.method)) {
    await reply.status(403).send({
      success: false,
      error: {
        code: 'READ_ONLY_DEPLOYMENT',
        message: 'This TRACE deployment is a read-only public research showcase.',
      },
    });
  }
}
