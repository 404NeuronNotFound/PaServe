import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiOverloadedException } from '../http/api-overloaded.exception.js';

export type Workload =
  'general' | 'auth' | 'stream' | 'expensive' | 'critical' | 'health';

@Injectable()
export class ApiCapacityService {
  readonly limits: Readonly<Record<Workload | 'total' | 'perIp', number>>;
  readonly criticalReserve: number;
  readonly criticalPerIpReserve: number;
  readonly menuReserve: number;
  readonly menuPerIpReserve: number;
  private menuActive = 0;
  private readonly clients = new Map<
    string,
    { total: number; ordinary: number; menu: number }
  >();
  private readonly active = {
    total: 0,
    general: 0,
    auth: 0,
    stream: 0,
    expensive: 0,
    critical: 0,
    health: 0,
  };
  private readonly rejected = { total: 0, client: 0, workload: 0, reserved: 0 };
  private peak = 0;
  private admitted = 0;
  private completed = 0;

  constructor(config: ConfigService) {
    const integer = (name: string, fallback: number, max: number) => {
      const value = Number(config.get<string>(name) ?? fallback);
      if (!Number.isInteger(value) || value < 1 || value > max)
        throw new Error(`${name} must be an integer between 1 and ${max}`);
      return value;
    };
    const total = integer('API_MAX_IN_FLIGHT', 128, 4096);
    if (total < 3) throw new Error('API_MAX_IN_FLIGHT must be at least 3');
    this.criticalReserve = integer(
      'API_RESERVED_CRITICAL',
      Math.min(16, total - 2),
      total - 2,
    );
    const perIp = integer(
      'API_MAX_IN_FLIGHT_PER_IP',
      Math.min(16, total - 1),
      total - 1,
    );
    if (perIp < 2)
      throw new Error('API_MAX_IN_FLIGHT_PER_IP must be at least 2');
    this.criticalPerIpReserve = integer(
      'API_RESERVED_CRITICAL_PER_IP',
      Math.min(2, perIp - 1),
      perIp - 1,
    );
    this.limits = Object.freeze({
      total,
      general: total - this.criticalReserve - 1,
      critical: total - 1,
      health: 1,
      perIp,
      auth: integer(
        'API_MAX_AUTH_IN_FLIGHT',
        Math.min(32, total - 1),
        total - 1,
      ),
      stream: integer('API_MAX_STREAMS', Math.min(32, total - 1), total - 1),
      expensive: integer(
        'API_MAX_EXPENSIVE_IN_FLIGHT',
        Math.min(16, total - 1),
        total - 1,
      ),
    });
    const reserve = (name: string, fallback: number, max: number) => {
      const value = Number(config.get(name) ?? fallback);
      if (!Number.isInteger(value) || value < 0 || value > max)
        throw new Error(`${name} must be an integer between 0 and ${max}`);
      return value;
    };
    this.menuReserve = reserve(
      'API_RESERVED_MENU_READS',
      Math.min(8, Math.floor(this.limits.general / 8)),
      this.limits.general - 1,
    );
    const ordinaryPerIp = perIp - this.criticalPerIpReserve;
    this.menuPerIpReserve = reserve(
      'API_RESERVED_MENU_READS_PER_IP',
      Math.min(this.menuReserve, Math.floor(ordinaryPerIp / 8)),
      ordinaryPerIp - 1,
    );
  }

  acquire(client: string, workload: Workload, menuRead = false): () => void {
    menuRead = menuRead && workload === 'general';
    const clientActive = this.clients.get(client) ?? {
      total: 0,
      ordinary: 0,
      menu: 0,
    };
    const ordinary = workload !== 'critical' && workload !== 'health';
    const ordinaryActive =
      this.active.total - this.active.critical - this.active.health;
    const reason =
      this.active.total >= this.limits.total
        ? 'total'
        : clientActive.total >= this.limits.perIp
          ? 'client'
          : ordinary &&
              clientActive.ordinary >=
                this.limits.perIp - this.criticalPerIpReserve
            ? 'client'
            : ordinary &&
                !menuRead &&
                clientActive.ordinary - clientActive.menu >=
                  this.limits.perIp -
                    this.criticalPerIpReserve -
                    this.menuPerIpReserve
              ? 'client'
              : ordinary &&
                  !menuRead &&
                  ordinaryActive - this.menuActive >=
                    this.limits.general - this.menuReserve
                ? 'reserved'
                : ordinary && ordinaryActive >= this.limits.general
                  ? 'reserved'
                  : workload !== 'health' &&
                      this.active.total - this.active.health >=
                        this.limits.total - 1
                    ? 'reserved'
                    : this.active[workload] >= this.limits[workload]
                      ? 'workload'
                      : undefined;
    if (reason) {
      this.rejected[reason]++;
      throw new ApiOverloadedException();
    }
    // No queue, waiter, timer, rejected-client entry or per-request log is allocated.
    this.clients.set(client, {
      total: clientActive.total + 1,
      ordinary: clientActive.ordinary + Number(ordinary),
      menu: clientActive.menu + Number(menuRead),
    });
    this.menuActive += Number(menuRead);
    this.active.total++;
    this.active[workload]++;
    this.admitted++;
    this.peak = Math.max(this.peak, this.active.total);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const current = this.clients.get(client)!;
      const remaining = current.total - 1;
      if (remaining)
        this.clients.set(client, {
          total: remaining,
          ordinary: current.ordinary - Number(ordinary),
          menu: current.menu - Number(menuRead),
        });
      else this.clients.delete(client);
      this.active.total--;
      this.menuActive -= Number(menuRead);
      this.active[workload]--;
      this.completed++;
    };
  }

  /** Internal, aggregate-only snapshot. Never includes IPs, tokens or tenant IDs. */
  snapshot() {
    return {
      limits: this.limits,
      criticalReserve: this.criticalReserve,
      criticalPerIpReserve: this.criticalPerIpReserve,
      menuReserve: this.menuReserve,
      menuPerIpReserve: this.menuPerIpReserve,
      activeMenuReads: this.menuActive,
      active: { ...this.active },
      rejected: { ...this.rejected },
      trackedClients: this.clients.size,
      peak: this.peak,
      admitted: this.admitted,
      completed: this.completed,
    };
  }
}
