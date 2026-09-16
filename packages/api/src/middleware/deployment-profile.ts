import type { FastifyReply, FastifyRequest } from 'fastify';
import { env, type Env } from '../env.js';

const READ_ONLY_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export function isReadOnlyProfile(profile: Env['TRACE_DEPLOYMENT_PROFILE']): boolean {
  return profile === 'public_showcase' || profile === 'public_sandbox';
}

export function isRequestAllowed(
  profile: Env['TRACE_DEPLOYMENT_PROFILE'],
  method: string,
): boolean {
  return !isReadOnlyProfile(profile) || READ_ONLY_METHODS.has(method.toUpperCase());
}

/**
 * Whether public marketplace browse (listings search, stats, facets) should
 * be scoped to the curated demo catalogue only. True for public_buyer_demo
 * alone: self_hosted has no curated tag on real inventory, and
 * public_showcase/public_sandbox are read-only exposures of the same curated
 * research showcase, not a mixed visitor+curated demo.
 */
export function curatedBrowseOnly(profile: Env['TRACE_DEPLOYMENT_PROFILE']): boolean {
  return profile === 'public_buyer_demo';
}

/**
 * Read-only public exposure profiles are protected at the API boundary,
 * independently of the web UI and reverse proxy. public_buyer_demo permits
 * normal buyer requests and relies on the existing role guards for all
 * supplier, passport, quality, and administrative mutations.
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
