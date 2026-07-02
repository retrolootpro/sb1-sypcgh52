import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

export type Database = {
  public: {
    Tables: {
      inventory_items: {
        Row: {
          id: string;
          user_id: string;
          product_name: string;
          console: string;
          condition: 'Loose' | 'CIB' | 'New';
          purchase_price: number;
          quantity: number;
          notes: string;
          image_url: string;
          barcode: string;
          sku?: string | null;
          clover_item_id?: string | null;
          clover_variant_id?: string | null;
          clover_synced_at?: string | null;
          clover_sync_status?: 'pending' | 'synced' | 'failed';
          clover_sync_error?: string | null;
          sync_to_clover?: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          product_name: string;
          console: string;
          condition: 'Loose' | 'CIB' | 'New';
          purchase_price: number;
          quantity?: number;
          notes?: string;
          image_url?: string;
          barcode?: string;
          sku?: string | null;
          clover_item_id?: string | null;
          clover_variant_id?: string | null;
          clover_synced_at?: string | null;
          clover_sync_status?: 'pending' | 'synced' | 'failed';
          clover_sync_error?: string | null;
          sync_to_clover?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          product_name?: string;
          console?: string;
          condition?: 'Loose' | 'CIB' | 'New';
          purchase_price?: number;
          quantity?: number;
          notes?: string;
          image_url?: string;
          barcode?: string;
          sku?: string | null;
          clover_item_id?: string | null;
          clover_variant_id?: string | null;
          clover_synced_at?: string | null;
          clover_sync_status?: 'pending' | 'synced' | 'failed';
          clover_sync_error?: string | null;
          sync_to_clover?: boolean;
          created_at?: string;
          updated_at?: string;
        };
      };
      pricing_data: {
        Row: {
          id: string;
          item_id: string;
          loose_price: number;
          cib_price: number;
          new_price: number;
          fetched_at: string;
        };
        Insert: {
          id?: string;
          item_id: string;
          loose_price?: number;
          cib_price?: number;
          new_price?: number;
          fetched_at?: string;
        };
        Update: {
          id?: string;
          item_id?: string;
          loose_price?: number;
          cib_price?: number;
          new_price?: number;
          fetched_at?: string;
        };
      };
      ebay_comps: {
        Row: {
          id: string;
          item_id: string;
          sold_price: number;
          sold_date: string;
          listing_title: string;
          fetched_at: string;
        };
        Insert: {
          id?: string;
          item_id: string;
          sold_price: number;
          sold_date: string;
          listing_title: string;
          fetched_at?: string;
        };
        Update: {
          id?: string;
          item_id?: string;
          sold_price?: number;
          sold_date?: string;
          listing_title?: string;
          fetched_at?: string;
        };
      };
      show_lists: {
        Row: {
          id: string;
          user_id: string;
          name: string;
          show_date: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          name: string;
          show_date?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          name?: string;
          show_date?: string | null;
          created_at?: string;
        };
      };
      show_items: {
        Row: {
          id: string;
          show_list_id: string;
          item_id: string;
          start_price: number;
          category: string;
        };
        Insert: {
          id?: string;
          show_list_id: string;
          item_id: string;
          start_price: number;
          category?: string;
        };
        Update: {
          id?: string;
          show_list_id?: string;
          item_id?: string;
          start_price?: number;
          category?: string;
        };
      };
    };
  };
};
