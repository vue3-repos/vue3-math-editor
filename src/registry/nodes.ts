export interface FunctionDefinition {
  name: string
  latexName: string
  mathMlTag?: string
}

export const FUNCTION_REGISTRY: Record<string, FunctionDefinition> = {
  exp: { name: 'exp', latexName: 'exp', mathMlTag: 'exp' },
  log: { name: 'log', latexName: 'log', mathMlTag: 'log' },
  ln: { name: 'ln', latexName: 'ln', mathMlTag: 'ln' },
  sin: { name: 'sin', latexName: 'sin', mathMlTag: 'sin' },
  cos: { name: 'cos', latexName: 'cos', mathMlTag: 'cos' },
  tan: { name: 'tan', latexName: 'tan', mathMlTag: 'tan' },
  sec: { name: 'sec', latexName: 'sec', mathMlTag: 'sec' },
  csc: { name: 'csc', latexName: 'csc', mathMlTag: 'csc' },
  cot: { name: 'cot', latexName: 'cot', mathMlTag: 'cot' },
  asin: { name: 'asin', latexName: 'arcsin', mathMlTag: 'arcsin' },
  acos: { name: 'acos', latexName: 'arccos', mathMlTag: 'arccos' },
  atan: { name: 'atan', latexName: 'arctan', mathMlTag: 'arctan' },
  sinh: { name: 'sinh', latexName: 'sinh', mathMlTag: 'sinh' },
  cosh: { name: 'cosh', latexName: 'cosh', mathMlTag: 'cosh' },
  tanh: { name: 'tanh', latexName: 'tanh', mathMlTag: 'tanh' },
}

export function getFunctionDefinition(name: string): FunctionDefinition | null {
  return FUNCTION_REGISTRY[name.toLowerCase()] ?? null
}
