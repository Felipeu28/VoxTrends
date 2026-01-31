/**
 * Structured Logging Service
 * Phase 1: Comprehensive logging for debugging and analytics
 */

export type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  service: string;
  action: string;
  message?: string;
  metadata?: Record<string, any>;
  duration_ms?: number;
}

/**
 * Structured logging service
 * Logs to console with formatted output
 * Can be extended to send to backend/database
 */
export class Logger {
  private service: string;

  constructor(service: string) {
    this.service = service;
  }

  private formatLog(
    level: LogLevel,
    action: string,
    message?: string,
    metadata?: Record<string, any>,
    duration_ms?: number
  ): LogEntry {
    return {
      timestamp: new Date().toISOString(),
      level,
      service: this.service,
      action,
      message,
      metadata,
      duration_ms,
    };
  }

  debug(action: string, message?: string, metadata?: Record<string, any>) {
    const log = this.formatLog('DEBUG', action, message, metadata);
    console.log(
      `🔍 [${this.service}] ${action}:`,
      message || '',
      metadata ? JSON.stringify(metadata) : ''
    );
  }

  info(
    action: string,
    message?: string,
    metadata?: Record<string, any>,
    duration_ms?: number
  ) {
    const log = this.formatLog('INFO', action, message, metadata, duration_ms);
    const timing = duration_ms ? ` (${duration_ms}ms)` : '';
    console.log(
      `ℹ️ [${this.service}] ${action}:`,
      message || '',
      timing,
      metadata ? JSON.stringify(metadata) : ''
    );
  }

  warn(action: string, message?: string, metadata?: Record<string, any>) {
    const log = this.formatLog('WARN', action, message, metadata);
    console.warn(
      `⚠️ [${this.service}] ${action}:`,
      message || '',
      metadata ? JSON.stringify(metadata) : ''
    );
  }

  error(action: string, message?: string, metadata?: Record<string, any>) {
    const log = this.formatLog('ERROR', action, message, metadata);
    console.error(
      `❌ [${this.service}] ${action}:`,
      message || '',
      metadata ? JSON.stringify(metadata) : ''
    );
  }

  timing(action: string, duration_ms: number, metadata?: Record<string, any>) {
    console.log(
      `⏱️ [${this.service}] ${action}: ${duration_ms}ms`,
      metadata ? JSON.stringify(metadata) : ''
    );
  }
}

// Export singleton loggers for common services
export const generateEditionLogger = new Logger('generate-edition');
export const cacheLogger = new Logger('cache');
export const authLogger = new Logger('auth');
export const databaseLogger = new Logger('database');
