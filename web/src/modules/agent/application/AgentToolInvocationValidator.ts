import type { ModelToolCall } from '@/capabilities/ai-runtime/public';
import type { JsonObject } from '@/kernel/public';
import type { AgentToolDefinition } from '../domain/AgentToolRegistry';
import {
  AgentToolPolicyDecision,
  type AgentToolExecutionContext,
  type AgentToolPolicy,
  type AgentToolPolicyResult
} from '../contracts/AgentRuntimePorts';

export interface AgentToolValidationResult {
  readonly valid: boolean;
  readonly errors: readonly string[];
}

/** Validates the JSON Schema subset supported by provider-visible Tool manifests. */
export class AgentToolInvocationValidator {
  validate(
    definition: AgentToolDefinition,
    call: ModelToolCall
  ): AgentToolValidationResult {
    const errors: string[] = [];
    validateValue(call.arguments, definition.inputSchema, '$', errors);
    return { valid: errors.length === 0, errors };
  }

  async evaluate(
    policy: AgentToolPolicy,
    definition: AgentToolDefinition,
    call: ModelToolCall,
    context: AgentToolExecutionContext
  ): Promise<AgentToolPolicyResult> {
    const validation = this.validate(definition, call);
    if (!validation.valid) {
      return {
        decision: AgentToolPolicyDecision.Reject,
        reasonCode: 'agent.tool_arguments_invalid',
        message: `工具参数不符合约定：${validation.errors.join('；')}`,
        retryable: true
      };
    }
    return policy.evaluate(definition, call, context);
  }
}

function validateValue(
  value: unknown,
  schema: JsonObject,
  path: string,
  errors: string[]
): void {
  if (Array.isArray(schema.enum) && !schema.enum.some((item) => Object.is(item, value))) {
    errors.push(`${path} 不在允许的枚举范围内`);
    return;
  }

  const types = schemaTypes(schema.type);
  const matchedType = types.find((type) => matchesType(value, type));
  if (types.length && !matchedType) {
    errors.push(`${path} 必须是 ${types.join(' 或 ')}`);
    return;
  }

  if (matchedType === 'object' && isRecord(value)) validateObject(value, schema, path, errors);
  if (matchedType === 'array' && Array.isArray(value)) validateArray(value, schema, path, errors);
  if (matchedType === 'string' && typeof value === 'string') validateString(value, schema, path, errors);
  if ((matchedType === 'number' || matchedType === 'integer') && typeof value === 'number') {
    validateNumber(value, schema, path, errors);
  }
}

function validateObject(
  value: Record<string, unknown>,
  schema: JsonObject,
  path: string,
  errors: string[]
): void {
  const properties = isRecord(schema.properties)
    ? schema.properties as Record<string, JsonObject>
    : {};
  const required = Array.isArray(schema.required)
    ? schema.required.filter((item): item is string => typeof item === 'string')
    : [];
  required.forEach((key) => {
    if (!Object.prototype.hasOwnProperty.call(value, key)) errors.push(`${path}.${key} 为必填参数`);
  });
  if (schema.additionalProperties === false) {
    Object.keys(value)
      .filter((key) => !Object.prototype.hasOwnProperty.call(properties, key))
      .forEach((key) => errors.push(`${path}.${key} 是未声明参数`));
  }
  Object.entries(value).forEach(([key, entry]) => {
    const propertySchema = properties[key];
    if (propertySchema) validateValue(entry, propertySchema, `${path}.${key}`, errors);
  });
}

function validateArray(
  value: readonly unknown[],
  schema: JsonObject,
  path: string,
  errors: string[]
): void {
  const minimum = numberValue(schema.minItems);
  const maximum = numberValue(schema.maxItems);
  if (minimum !== undefined && value.length < minimum) errors.push(`${path} 至少需要 ${minimum} 项`);
  if (maximum !== undefined && value.length > maximum) errors.push(`${path} 最多允许 ${maximum} 项`);
  if (isRecord(schema.items)) {
    value.forEach((entry, index) => validateValue(entry, schema.items as JsonObject, `${path}[${index}]`, errors));
  }
}

function validateString(
  value: string,
  schema: JsonObject,
  path: string,
  errors: string[]
): void {
  const minimum = numberValue(schema.minLength);
  const maximum = numberValue(schema.maxLength);
  if (minimum !== undefined && value.length < minimum) errors.push(`${path} 长度不能少于 ${minimum}`);
  if (maximum !== undefined && value.length > maximum) errors.push(`${path} 长度不能超过 ${maximum}`);
}

function validateNumber(
  value: number,
  schema: JsonObject,
  path: string,
  errors: string[]
): void {
  if (!Number.isFinite(value)) {
    errors.push(`${path} 必须是有限数值`);
    return;
  }
  const minimum = numberValue(schema.minimum);
  const maximum = numberValue(schema.maximum);
  if (minimum !== undefined && value < minimum) errors.push(`${path} 不能小于 ${minimum}`);
  if (maximum !== undefined && value > maximum) errors.push(`${path} 不能大于 ${maximum}`);
}

function matchesType(value: unknown, type: string): boolean {
  if (type === 'object') return isRecord(value);
  if (type === 'array') return Array.isArray(value);
  if (type === 'string') return typeof value === 'string';
  if (type === 'number') return typeof value === 'number' && Number.isFinite(value);
  if (type === 'integer') return typeof value === 'number' && Number.isInteger(value);
  if (type === 'boolean') return typeof value === 'boolean';
  if (type === 'null') return value === null;
  return true;
}

function schemaTypes(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string')
    : [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function numberValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}
