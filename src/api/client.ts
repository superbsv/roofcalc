// ============================================
// ArtBudTrading Roof Calculator
// api/client.ts — HTTP клієнт
// ============================================

const BASE = process.env.REACT_APP_API_URL || '/api';

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
    window.location.href = '/login';
    throw new Error('Не авторизовано');
  }

  // Сервер може повернути не-JSON (помилка хостингу, HTML) — показуємо зрозуміле повідомлення
  const text = await res.text();
  let data: any;
  try { data = text ? JSON.parse(text) : {}; }
  catch { throw new Error(`Помилка сервера (${res.status}). Спробуйте ще раз або зверніться в підтримку.`); }
  if (!res.ok) throw new Error((data.error || 'Помилка сервера') + (data.detail ? `: ${data.detail}` : ''));
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
  is_superadmin?: boolean;      // супер-адмін платформи
  impersonating?: boolean;      // супер-адмін зараз у чужому кабінеті («Увійти як»)
  tenant?: TenantBrief | null;  // кабінет, у якому працює користувач
}

export interface TenantBrief {
  id: number; name: string; plan: string; status: string; is_internal: number | string;
  trial_until?: string | null; paid_until?: string | null; active: boolean;
  doc_company?: string | null;
}

export interface PlanDef {
  name: string; price: number; users: number | null; projects_month: number | null;
  days?: number | null; public?: boolean; popular?: boolean; features: string[];
  price_year?: number | null; price_from?: boolean; // ціна за рік; «від …» для ціни за домовленістю
}

// Налаштування власного кабінету
export interface TenantSettings {
  id: number; name: string; plan: string; status: string; is_internal: number | string;
  trial_until?: string | null; paid_until?: string | null; active: boolean;
  doc_company?: string | null; doc_requisites?: string | null; doc_address?: string | null;
  doc_phone?: string | null; doc_email?: string | null; doc_site?: string | null;
  brand_color?: string | null; logo?: string | null; next_order_no: number;
}
export interface TenantInfo {
  tenant: TenantSettings; plan: { key: string; name: string };
  limits: { users: number | null; projects_month: number | null };
  usage: { users: number; projects_month: number };
}
export interface TeamUser {
  id: number; name: string; email?: string; login: string; role: User['role'];
  is_active: number | string; last_login_at?: string | null;
}
export const teamApi = {
  list:   () => get<{ users: TeamUser[] }>('/admin/users'),
  create: (body: Record<string, unknown>) => post<{ user: TeamUser }>('/admin/users', body),
  update: (id: number, body: Record<string, unknown>) => put<{ user: TeamUser }>(`/admin/users/${id}`, body),
};
export const tenantApi = {
  get:    () => get<TenantInfo>('/tenant'),
  update: (body: Partial<TenantSettings>) => put<TenantInfo>('/tenant', body),
};

export const authApi = {
  login: (login: string, password: string) =>
    post<{ token: string; user: User; expires_in: number }>('/auth/login', { login, password }),
  logout: () => post<{}>('/auth/logout', {}),
  me: () => get<{ user: User }>('/auth/me'),
  register: (body: { company: string; name: string; email: string; phone: string; password: string; website?: string }) =>
    post<{ token: string; user: User }>('/auth/register', body),
  plans: () => get<{ plans: Record<string, PlanDef> }>('/plans'),
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
  settings?: ProjectSettings;
  created_at: string; updated_at: string;
}

// Реквізити замовлення і параметри проєкту як у «Кровля Профи»
export type CalcType = 'tile' | 'piece' | 'profile' | 'falts' | 'sheet' | 'siding';
export type CalcMode = 'order' | 'stock1' | 'stock2' | 'stock3';
export interface ProjectSettings {
  calc_type?: CalcType;
  material_id?: number;
  order_no?: string; order_date?: string;
  company?: string; responsible?: string;
  currency?: string; rate?: number;
  supply?: 'order' | 'stock'; stock_variant?: 1 | 2 | 3;
  k?: number; pk?: number;
  direction?: 'left_right' | 'right_left';
  coating?: string; color?: string;
  round_step?: number | null;   // округлення довжин листів для всього розрахунку, мм (null — з матеріалу)
  step?: string;
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
  calculateAll:(id: number)         => post<{ skipped?: string[] }>(`/projects/${id}/calculate-all`, {}),
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
  edge_types?: EdgeType[];            // тип кожного ребра (сторона i → i+1)
  element_kind?: 'roof' | 'facade';   // скат покрівлі або фасад
  calc_mode?: CalcMode | 'stock';     // «на замовлення» / «зі складу» 1-2-3
  joint_y?: number | null;            // лінія стику рядів, мм (null — посередині)
  split_forced?: boolean | number | null; // стик на вимогу, навіть коли вистачає одного листа
  layout_shift?: number | null;       // зсув сітки колонок по горизонталі, мм
  round_step?: number | null;         // округлення довжин листів для ската, мм (null — з матеріалу)
  created_at: string; updated_at: string;
}

export type EdgeType = 'eave' | 'ridge' | 'hip' | 'valley' | 'end' | 'abutment' | 'none';

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
  sheet_full_width?: number;
  sheet_useful_width?: number;
  holes_area_m2?: number;
  mode?: 'order' | 'stock' | 'stock1' | 'stock2' | 'stock3' | 'fixed' | 'sheetcut';
  material_type?: string;
  laid_sheets?: number;
  laid_by_length?: SheetGroup[];
  cutting?: CuttingGroup[];
  stock_usage?: { length: number; used: number; available: number | null }[];
  alternatives?: { rows: number[]; running_m: number }[];
  running_m?: number;
  max_real_length_mm?: number; max_std_length_mm?: number; rounding_mm?: number;
  split_forced?: boolean; layout_shift_mm?: number; joint_y_mm?: number | null; joint_range_mm?: [number, number] | null; joint_custom?: boolean;
}

export interface CuttingGroup {
  from: number; to: number; count: number; sheet_length: number;
  cuts: number[]; remainder: number; missing?: boolean;
}

export interface AccessoryType {
  id: number; code: string; name: string; unit: string;
  working_length: number; default_overlap: number; price: number | string; calc_rule: string;
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
  hip_length_m?: number; abutment_length_m?: number;
  edges_by_type?: boolean;
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
  id: number; type: 'tile'|'tile_module'|'profile'|'sheet'|'natural_tile'|'falts'; name: string;
  tenant_id?: number | null;   // null — загальний каталог ABT
  manufacturer?: string;
  full_width: number; useful_width: number;
  side_overlap: number; length_overlap: number;
  wave_step?: number; cut_step?: number; min_length: number; max_length: number;
  forbidden_lengths?: Array<{min:number;max:number} | [number, number]>;
  stock_lengths?: Array<number | [number, number | null] | {length:number; qty?:number|null}>;
  round_step?: number; max_std_length?: number;
  lock_type?: string; min_joint_distance?: number; join_overlap?: number;
  min_slope_angle: number; price_per_m2: number; wave_height?: number;
  color_options?: string[]; coating_options?: string[]; thickness_options?: number[];
  is_active: boolean;
}

export const materialsApi = {
  list:   ()                   => get<{ profiles: MaterialProfile[] }>('/materials'),
  byType: (type: string)       => get<{ profiles: MaterialProfile[] }>(`/materials/${type}`),
  get:    (id: number)         => get<{ profile: MaterialProfile }>(`/materials/${id}`),
  accessories: ()              => get<{ accessories: AccessoryType[] }>('/accessories'),
  // Редагування довідника з вікна матеріалу (адміністратор / менеджер)
  create: (body: Partial<MaterialProfile>)             => post<{ id: number }>('/admin/materials', body),
  update: (id: number, body: Partial<MaterialProfile>) => put<{ message: string }>(`/admin/materials/${id}`, body),
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

// ============================================
// SUPER-ADMIN: кабінети платформи
// ============================================
export type TenantState = 'internal' | 'active' | 'trial' | 'expired' | 'blocked';
export interface Tenant {
  id: number; name: string; plan: string; status: 'active' | 'trial' | 'blocked';
  is_internal: number | string; trial_until?: string | null; paid_until?: string | null;
  max_users?: number | null; max_projects_month?: number | null;
  contact_name?: string | null; contact_email?: string | null; contact_phone?: string | null;
  city?: string | null; notes?: string | null; created_at: string;
  state: TenantState;
  users_count?: number; projects_count?: number; projects_30d?: number; last_login_at?: string | null;
}
export interface TenantUser {
  id: number; name: string; email?: string; login: string; role: User['role'];
  is_active: number | string; last_login_at?: string | null; created_at: string;
}
export interface TenantDetail {
  tenant: Tenant; users: TenantUser[]; plans: Record<string, string>;
  stats: { projects: number; projects_30d: number; materials: number };
  log: { action: string; created_at: string; user_name?: string }[];
}
export interface SuperStats {
  tenants: number; active: number; trial: number; expired: number; blocked: number;
  by_plan: Record<string, number>; users: number; projects_30d: number;
}

export const superApi = {
  stats:      () => get<{ stats: SuperStats; plans: Record<string, string>; plan_defs: Record<string, PlanDef> }>('/super/stats'),
  tenants:    (search = '') => get<{ tenants: Tenant[]; plans: Record<string, string> }>('/super/tenants' + (search ? '?search=' + encodeURIComponent(search) : '')),
  tenant:     (id: number) => get<TenantDetail>(`/super/tenants/${id}`),
  create:     (body: Record<string, unknown>) => post<TenantDetail>('/super/tenants', body),
  update:     (id: number, body: Partial<Tenant>) => put<TenantDetail>(`/super/tenants/${id}`, body),
  extend:     (id: number, months: number, plan?: string) => post<TenantDetail>(`/super/tenants/${id}/extend`, { months, plan }),
  addUser:    (id: number, body: Record<string, unknown>) => post<TenantDetail>(`/super/tenants/${id}/users`, body),
  impersonate:(id: number) => post<{ token: string; tenant: { id: number; name: string } }>(`/super/tenants/${id}/impersonate`, {}),
  leave:      () => post<{}>('/super/leave', {}),
  savePlans:  (plans: Record<string, Partial<PlanDef>>) => put<{ plans: Record<string, PlanDef> }>('/super/plans', { plans }),
};
