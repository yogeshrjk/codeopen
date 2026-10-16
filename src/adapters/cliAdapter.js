'use strict';

/**
 * Shared adapter interface. Each CLI adapts its real capabilities;
 * unsupported operations throw E_UNSUPPORTED with an actionable message
 * rather than faking a protocol.
 */

const ERRORS = {
  UNSUPPORTED: 'E_UNSUPPORTED',
  NOT_INSTALLED: 'E_NOT_INSTALLED',
  NOT_ELIGIBLE: 'E_NOT_ELIGIBLE',
  NO_WORKSPACE: 'E_NO_WORKSPACE',
  PROCESS_FAILED: 'E_PROCESS_FAILED',
  MALFORMED: 'E_MALFORMED',
  CANCELLED: 'E_CANCELLED',
};

class CliAdapterError extends Error {
  constructor(code, message, details) {
    super(message);
    this.name = 'CliAdapterError';
    this.code = code;
    this.details = details || {};
  }
}

class CliAdapter {
  constructor(options) {
    this.options = options || {};
    this.logger = this.options.logger || console;
    this.processManager = this.options.processManager;
    this.detection = null;
    this.version = null;
  }

  get cliName() {
    return 'base';
  }

  async detectInstallation() {
    throw new CliAdapterError(ERRORS.UNSUPPORTED, `${this.cliName}: detectInstallation not implemented`);
  }

  getVersion() {
    return this.version;
  }

  getCapabilities() {
    return {
      cli: this.cliName,
      interactiveSessions: false,
      modelSelection: false,
      sessionResumption: false,
      structuredOutput: false,
      streamingEvents: false,
      directFileEditing: false,
      cancellation: true,
      approvalControls: false,
      programmaticModelSelect: false,
    };
  }

  async authenticateIfNeeded() {
    return { required: false };
  }

  async listModelsRaw() {
    throw new CliAdapterError(ERRORS.UNSUPPORTED, `${this.cliName}: listModelsRaw not supported`);
  }

  async validateFreeModel() {
    throw new CliAdapterError(ERRORS.UNSUPPORTED, `${this.cliName}: validateFreeModel not supported`);
  }

  async createSession() {
    throw new CliAdapterError(ERRORS.UNSUPPORTED, `${this.cliName}: createSession not supported`);
  }

  async resumeSession() {
    throw new CliAdapterError(ERRORS.UNSUPPORTED, `${this.cliName}: resumeSession not supported`);
  }

  async selectModel() {
    throw new CliAdapterError(ERRORS.UNSUPPORTED, `${this.cliName}: selectModel not supported`);
  }

  async sendMessage() {
    throw new CliAdapterError(ERRORS.UNSUPPORTED, `${this.cliName}: sendMessage not supported`);
  }

  cancelRequest() {
    return false;
  }

  async getSessionStatus() {
    return { status: 'unknown' };
  }

  async dispose() {
    // no-op
  }
}

module.exports = {
  CliAdapter,
  CliAdapterError,
  ERRORS,
};
