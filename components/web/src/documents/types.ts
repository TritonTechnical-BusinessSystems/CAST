// Shared data shapes for Commercial Invoice / Packing List (INIT-0026 Phase 3).
// Mirrors the backend's buildCiContext/buildPlContext exactly
// (components/api/src/routes/logisticsDocuments.ts).

export interface Shipment {
  id: string;
  cw_ticket_id: number | null;
  company_id: number | null;
  incoterm: string | null;
  carrier: string | null;
  currency: string;
  awb_number: string | null;
  weight: number | null;
  show_weight_per_item: number;
  consignee_name: string | null;
  consignee_address: string | null;
  ship_to_same_as_consignee: number;
  export_statement: string | null;
  ci_flag_id: number | null;
  ci_date: string | null;
  shipper_tax_field: "ein" | "vat" | "eori" | "" | null;
  consignee_tax_field: "ein" | "vat" | "eori" | "" | null;
  consignee_ein: string | null;
  consignee_vat: string | null;
  consignee_eori: string | null;
}

export interface Company {
  id: number;
  name: string;
  address_line1: string | null;
  address_line2: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  country: string | null;
  phone: string | null;
  email: string | null;
  tax_id: string | null;
  logo_filename: string | null;
  address_block: string | null;
  pdf_code: string | null;
  ein: string | null;
  vat: string | null;
  eori: string | null;
  default_export_statement: string | null;
  is_default: number;
}

export interface CiFlag {
  id: number;
  name: string;
  content: string;
  color: string;
  font_size: number;
}

export interface BoxAssignment {
  label: string;
  qty: number;
}

export type PriceSource = "max_sold" | "avg_sold" | "catalog_price" | "catalog_msrp" | "manual";

export interface CiLineItem {
  cw_product_id: number;
  part_number: string | null;
  description: string | null;
  manufacturer: string | null;
  description_override: string | null;
  unit_of_measure: string | null;
  source_ticket_id: number | null;
  hs_code: string;
  hs_code_override: string | null;
  country_of_origin: string;
  country_of_origin_override: string | null;
  unit_price: number | null;
  max_unit_price: number | null;
  avg_unit_price: number | null;
  msrp: number | null;
  catalog_price: number | null;
  price_source: PriceSource | null;
  manual_price: number | null;
  total_qty: number;
  serial_numbers: string[];
  box_assignments: BoxAssignment[];
}

export interface InvoiceData {
  shipment: Shipment;
  company: Company | null;
  pieces: number;
  has_pallets: boolean;
  line_items: CiLineItem[];
  ci_flag: CiFlag | null;
  effective_export_statement: string;
}

export interface PlItem {
  cw_product_id: number;
  part_number: string | null;
  description: string | null;
  description_override: string | null;
  manufacturer: string | null;
  unit_of_measure: string | null;
  source_ticket_id: number | null;
  total_qty: number;
  serial_numbers: string[];
}

export interface PlBox {
  id: number;
  number: number;
  items: PlItem[];
}

export interface PlPallet {
  id: number;
  number: number;
  items: PlItem[];
  boxes: PlBox[];
}

export interface PackingListData {
  shipment: Shipment;
  company: Company | null;
  pieces: number;
  has_pallets: boolean;
  pallets: PlPallet[];
  standalone_boxes: PlBox[];
}

export interface CwTicketDetail {
  id: number;
  companyName: string;
  summary: string;
  siteName: string | null;
}

export const UM_ABBR: Record<string, string> = {
  Each: "EA",
  Box: "BX",
  Case: "CS",
  Pallet: "PL",
  Foot: "FT",
  Meter: "M",
  Kilogram: "KG",
  Pound: "LB",
};
