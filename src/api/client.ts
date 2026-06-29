// ============================================
// ArtBudTrading Roof Calculator
// api/client.ts — HTTP клієнт
// ============================================

const BASE = process.env.REACT_APP_API_URL || '/calculator/api';

function getToken(): string | null {
  return localStorage.getItem('rc_token');
}

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
  signal?: AbortSignal
): Promise<T> {
  const token = getToken();
  const res = await fetch(`${BASE}${path}`, {
    method,
    signal,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });

  if (res.status === 401) {
    localStorage.removeItem('rc_token');
    localStorage.removeItem('rc_user');
    window.location.href = '/calculator/login';
    throw new Error('Не авторизовано');
  }

  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Помилка сервера');
  return data as T;
}

const get  = <T>(path: string, signal?: AbortSignal) => request<T>('GET',    path, undefined, signal);
const post = <T>(path: string, body: unknown)          => request<T>('POST',   path, body);
const put  = <T>(path: string, body: unknown)          => request<T>('PUT',    path, body);
const del  = <T>(path: string)                         => request<T>('DELETE', path);

// ============================================
// AUTH
// ============================================
export interface User {
  id: number; name: string; email: string; login: string;
  role: 'admin'|'manager'|'dealer'|'production'|'viewer';
  company?: string; phone?: string; last_login_at?: string;
}

export const authApi = {
  login: (login: string, password: string) =>
    post<{ token: string; user: User; expires_in: number }>('/auth/login', { login, password }),
  logout: () => post<{}>('/auth/logout', {}),
  me: () => get<{ user: User }>('/auth/me'),
  changePassword: (current_password: string, new_password: string) =>
    post<{}>('/auth/change-password', { current_password, new_password }),
};

// ============================================
// PROJECTS
// ============================================
export interface Project {
  id: number; name: string; client_name?: string; client_phone?: string;
  client_email?: string; object_address?: string; roof_type?: string;
  notes?: string; status: 'draft'|'calculated'|'sent'|'archived';
  discount_pct: number; vat_pct: number;
  total_area?: number; total_price?: number;
  share_token?: string; manager_name?: string;
  created_at: string; updated_at: string;
}

export interface ProjectsResponse {
  data: Project[]; total: number; page: number; limit: number;
}

export const projectsApi = {
  list:  (params?: Record<string,string>) =>
    get<ProjectsResponse>('/projects' + (params ? '?' + new URLSearchParams(params) : '')),
  get:   (id: number) => get<{ project: Project; slopes: Slope[] }>(`/projects/${id}`),
  create:(body: Partial<Project>)   => post<{ project: Project }>('/projects', body),
  update:(id: number, body: Partial<Project>) => put<{ project: Project }>(`/projects/${id}`, body),
  delete:(id: number)               => del<{}>(`/projects/${id}`),
  calculateAll:(id: number)         => post<{}>(`/projects/${id}/calculate-all`, {}),
  share: (token: string)            => get<{project:Project;slopes:Slope[];specification:SpecItem[]}>(`/projects/share/${token}`),
};

// ============================================
// SLOPES
// ============================================
export type Point = [number, number]; // [x,y] в мм

export interface Slope {
  id: number; project_id: number; name: string; sort_order: number;
  polygon_points: Point[]; holes: Point[][];
  slope_angle: number; eave_side?: number; ridge_side?: number;
  laying_direction: 'left_right'|'right_left'|'bottom_top'|'top_bottom';
  eave_overhang: number; ridge_gap: number;
  material_profile_id?: number; material_name?: string; material_type?: string;
  material_color?: string; material_coating?: string; material_thickness?: number;
  calc_result?: CalcResult; calc_at?: string;
  created_at: string; updated_at: string;
}

export interface CalcResult {
  profile_name: string; slope_area_m2: number;
  slope_width_mm: number; slope_height_mm: number;
  cols_count: number; rows_count: number;
  total_sheets: number; sheet_length_mm: number;
  sheets_by_length: SheetGroup[];
  order_area_m2?: number; useful_area_m2?: number;
  total_full_area_m2?: number; waste_pct: number;
  placements: SheetPlacement[];
  accessories?: AccessoryResult;
  warnings: string[]; errors: string[];
}

export interface SheetGroup {
  length_mm: number; full_width_mm: number; count: number; full_area_m2: number;
}

export interface SheetPlacement {
  sheet_number: number; col_index: number; row_index: number;
  x: number; y: number;
  full_width: number; useful_width: number; length: number;
  intersect_area_m2?: number; full_area_m2?: number; waste_area_m2?: number;
}

export interface AccessoryResult {
  items: AccessoryItem[];
  eave_length_m: number; ridge_length_m: number;
  end_length_m: number; valley_length_m: number;
  slope_area_m2: number;
}

export interface AccessoryItem {
  code: string; name: string; unit: string;
  quantity: number; price: number; total: number; calc_rule: string;
}

export const slopesApi = {
  list:      (projectId: number)             => get<{ slopes: Slope[] }>(`/projects/${projectId}/slopes`),
  create:    (projectId: number, body: Partial<Slope>) =>
    post<{ slope: Slope }>(`/projects/${projectId}/slopes`, body),
  update:    (id: number, body: Partial<Slope>) => put<{ slope: Slope }>(`/slopes/${id}`, body),
  delete:    (id: number)                    => del<{}>(`/slopes/${id}`),
  calculate: (id: number)                    => post<{ result: CalcResult }>(`/slopes/${id}/calculate`, {}),
  layout:    (id: number)                    => get<{ placements: SheetPlacement[]; summary: object }>(`/slopes/${id}/layout`),
};

// ============================================
// MATERIALS
// ============================================
export interface MaterialProfile {
  id: number; type: 'tile'|'profile'|'falts'; name: string;
  manufacturer?: string;
  full_width: number; useful_width: number;
  side_overlap: number; length_overlap: number;
  wave_step?: number; min_length: number; max_length: number;
  forbidden_lengths?: Array<{min:number;max:number}>;
  stock_lengths?: number[];
  lock_type?: string; min_joint_distance?: number; join_overlap?: number;
  min_slope_angle: number; price_per_m2: number;
  color_options?: string[]; coating_options?: string[]; thickness_options?: number[];
  is_active: boolean;
}

export const materialsApi = {
  list:   ()                   => get<{ profiles: MaterialProfile[] }>('/materials'),
  byType: (type: string)       => get<{ profiles: MaterialProfile[] }>(`/materials/${type}`),
  get:    (id: number)         => get<{ profile: MaterialProfile }>(`/materials/${id}`),
};

// ============================================
// SPECIFICATION
// ============================================
export interface SpecItem {
  id: number; project_id: number; slope_id?: number;
  type: 'sheet'|'accessory'|'fastener'|'other';
  name: string; unit: string; quantity: number;
  length_mm?: number; full_area_m2?: number; useful_area_m2?: number;
  price: number; total: number; vat_included: boolean;
}

export const specApi = {
  get: (projectId: number) =>
    get<{ items: SpecItem[]; total: number }>(`/projects/${projectId}/specification`),
};

// ============================================
// EXPORT
// ============================================
export const exportApi = {
  pdf:           (projectId: number) => `${BASE}/projects/${projectId}/export/pdf?token=${getToken()}`,
  excel:         (projectId: number) => `${BASE}/projects/${projectId}/export/excel?token=${getToken()}`,
  productionPdf: (projectId: number) => `${BASE}/projects/${projectId}/export/production-pdf?token=${getToken()}`,
  json:          (projectId: number) => `${BASE}/projects/${projectId}/export/json?token=${getToken()}`,
};
