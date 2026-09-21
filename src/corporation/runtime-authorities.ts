import { AuthoritativeHllPort } from "./hll-authority-adapter.js";
import {
  SubprocessHllAuthorityTransport,
  hllSubprocessCommandFromEnv
} from "./hll-subprocess-transport.js";
import { VeraCoreAuthority } from "./vera-authority.js";
import {
  SubprocessVeraRpcTransport,
  veraSubprocessCommandFromEnv
} from "./vera-subprocess-transport.js";

/**
 * Production authority bundle for Corporation v2.
 *
 * Configuration supplies executable paths only. Semantic truth is owned by the
 * stateful Python HLL authority process and execution authority is owned by the
 * stateful Rust VERA T0 process. Koordynator owns neither authority.
 */
export type CorporationRuntimeAuthorities = {
  hll: AuthoritativeHllPort;
  vera: VeraCoreAuthority;
  close(): void;
};

export function corporationRuntimeAuthoritiesFromEnv(
  env: NodeJS.ProcessEnv = process.env
): CorporationRuntimeAuthorities {
  const hllTransport = new SubprocessHllAuthorityTransport(
    hllSubprocessCommandFromEnv(env)
  );
  const veraTransport = new SubprocessVeraRpcTransport(
    veraSubprocessCommandFromEnv(env)
  );

  return {
    hll: new AuthoritativeHllPort(hllTransport),
    vera: new VeraCoreAuthority(veraTransport),
    close: () => {
      hllTransport.close();
      veraTransport.close();
    }
  };
}
