export interface ProblemDetails {
  type: string;
  title: string;
  status: number;
  detail: string;
  instance: string;
  code?: string;
  timestamp: string;
  invalidParams?: Array<{
    name: string;
    reason: string;
  }>;
}

export function createProblemDetails(props: {
  status: number;
  title: string;
  detail: string;
  instance: string;
  code?: string;
  invalidParams?: Array<{ name: string; reason: string }>;
}): ProblemDetails {
  return {
    type: `https://api.movilidad.com/errors/${props.code?.toLowerCase().replace(/_/g, "-") ?? "error"}`,
    title: props.title,
    status: props.status,
    detail: props.detail,
    instance: props.instance,
    code: props.code,
    timestamp: new Date().toISOString(),
    invalidParams: props.invalidParams,
  };
}
