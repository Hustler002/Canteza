// GENERATED FILE -- do not edit by hand.
// Regenerate with: npm run db:types
// Source of truth: supabase/migrations/

export type Json = string | number | boolean | null | { [key: string]: Json } | Json[];

export type Database = {
  public: {
    Tables: {
    canteen_staff: {
      Row: {
        canteen_id: string;
        profile_id: string;
        created_at: string;
      };
      Insert: {
        canteen_id: string;
        profile_id: string;
        created_at?: string;
      };
      Update: {
        canteen_id?: string;
        profile_id?: string;
        created_at?: string;
      };
      Relationships: [
        {
          foreignKeyName: 'canteen_staff_canteen_id_fkey';
          columns: ['canteen_id'];
          isOneToOne: false;
          referencedRelation: 'canteens';
          referencedColumns: ['id'];
        },
        {
          foreignKeyName: 'canteen_staff_profile_id_fkey';
          columns: ['profile_id'];
          isOneToOne: false;
          referencedRelation: 'profiles';
          referencedColumns: ['id'];
        },
      ];
    };
    canteens: {
      Row: {
        id: string;
        name: string;
        description: string;
        image_url: string | null;
        is_accepting_orders: boolean;
        opens_at: string;
        closes_at: string;
        min_order_paise: number;
        phone: string | null;
        is_active: boolean;
        created_at: string;
        updated_at: string;
      };
      Insert: {
        id?: string;
        name: string;
        description?: string;
        image_url?: string | null;
        is_accepting_orders?: boolean;
        opens_at?: string;
        closes_at?: string;
        min_order_paise?: number;
        phone?: string | null;
        is_active?: boolean;
        created_at?: string;
        updated_at?: string;
      };
      Update: {
        id?: string;
        name?: string;
        description?: string;
        image_url?: string | null;
        is_accepting_orders?: boolean;
        opens_at?: string;
        closes_at?: string;
        min_order_paise?: number;
        phone?: string | null;
        is_active?: boolean;
        created_at?: string;
        updated_at?: string;
      };
      Relationships: [];
    };
    coupon_redemptions: {
      Row: {
        id: string;
        coupon_id: string;
        student_id: string;
        order_id: string;
        discount_paise: number;
        created_at: string;
      };
      Insert: {
        id?: string;
        coupon_id: string;
        student_id: string;
        order_id: string;
        discount_paise: number;
        created_at?: string;
      };
      Update: {
        id?: string;
        coupon_id?: string;
        student_id?: string;
        order_id?: string;
        discount_paise?: number;
        created_at?: string;
      };
      Relationships: [
        {
          foreignKeyName: 'coupon_redemptions_coupon_id_fkey';
          columns: ['coupon_id'];
          isOneToOne: false;
          referencedRelation: 'coupons';
          referencedColumns: ['id'];
        },
        {
          foreignKeyName: 'coupon_redemptions_order_id_fkey';
          columns: ['order_id'];
          isOneToOne: false;
          referencedRelation: 'orders';
          referencedColumns: ['id'];
        },
        {
          foreignKeyName: 'coupon_redemptions_student_id_fkey';
          columns: ['student_id'];
          isOneToOne: false;
          referencedRelation: 'profiles';
          referencedColumns: ['id'];
        },
      ];
    };
    coupons: {
      Row: {
        id: string;
        code: string;
        kind: string;
        amount_paise: number | null;
        percent_off: number | null;
        max_discount_paise: number | null;
        min_order_paise: number;
        max_redemptions: number | null;
        per_student_limit: number;
        valid_from: string;
        valid_until: string | null;
        is_active: boolean;
        created_at: string;
        updated_at: string;
      };
      Insert: {
        id?: string;
        code: string;
        kind: string;
        amount_paise?: number | null;
        percent_off?: number | null;
        max_discount_paise?: number | null;
        min_order_paise?: number;
        max_redemptions?: number | null;
        per_student_limit?: number;
        valid_from?: string;
        valid_until?: string | null;
        is_active?: boolean;
        created_at?: string;
        updated_at?: string;
      };
      Update: {
        id?: string;
        code?: string;
        kind?: string;
        amount_paise?: number | null;
        percent_off?: number | null;
        max_discount_paise?: number | null;
        min_order_paise?: number;
        max_redemptions?: number | null;
        per_student_limit?: number;
        valid_from?: string;
        valid_until?: string | null;
        is_active?: boolean;
        created_at?: string;
        updated_at?: string;
      };
      Relationships: [];
    };
    delivery_partners: {
      Row: {
        profile_id: string;
        canteen_id: string;
        is_approved: boolean;
        is_active: boolean;
        is_online: boolean;
        created_at: string;
        updated_at: string;
      };
      Insert: {
        profile_id: string;
        canteen_id: string;
        is_approved?: boolean;
        is_active?: boolean;
        is_online?: boolean;
        created_at?: string;
        updated_at?: string;
      };
      Update: {
        profile_id?: string;
        canteen_id?: string;
        is_approved?: boolean;
        is_active?: boolean;
        is_online?: boolean;
        created_at?: string;
        updated_at?: string;
      };
      Relationships: [
        {
          foreignKeyName: 'delivery_partners_canteen_id_fkey';
          columns: ['canteen_id'];
          isOneToOne: false;
          referencedRelation: 'canteens';
          referencedColumns: ['id'];
        },
        {
          foreignKeyName: 'delivery_partners_profile_id_fkey';
          columns: ['profile_id'];
          isOneToOne: false;
          referencedRelation: 'profiles';
          referencedColumns: ['id'];
        },
      ];
    };
    favorites: {
      Row: {
        student_id: string;
        menu_item_id: string;
        created_at: string;
      };
      Insert: {
        student_id: string;
        menu_item_id: string;
        created_at?: string;
      };
      Update: {
        student_id?: string;
        menu_item_id?: string;
        created_at?: string;
      };
      Relationships: [
        {
          foreignKeyName: 'favorites_menu_item_id_fkey';
          columns: ['menu_item_id'];
          isOneToOne: false;
          referencedRelation: 'menu_items';
          referencedColumns: ['id'];
        },
        {
          foreignKeyName: 'favorites_student_id_fkey';
          columns: ['student_id'];
          isOneToOne: false;
          referencedRelation: 'profiles';
          referencedColumns: ['id'];
        },
      ];
    };
    food_categories: {
      Row: {
        id: string;
        name: string;
        sort_order: number;
      };
      Insert: {
        id?: string;
        name: string;
        sort_order?: number;
      };
      Update: {
        id?: string;
        name?: string;
        sort_order?: number;
      };
      Relationships: [];
    };
    hostels: {
      Row: {
        id: string;
        name: string;
        blocks: string[];
        is_active: boolean;
        created_at: string;
        updated_at: string;
      };
      Insert: {
        id?: string;
        name: string;
        blocks?: string[];
        is_active?: boolean;
        created_at?: string;
        updated_at?: string;
      };
      Update: {
        id?: string;
        name?: string;
        blocks?: string[];
        is_active?: boolean;
        created_at?: string;
        updated_at?: string;
      };
      Relationships: [];
    };
    menu_items: {
      Row: {
        id: string;
        canteen_id: string;
        category_id: string | null;
        name: string;
        description: string;
        price_paise: number;
        image_url: string | null;
        is_veg: boolean;
        is_available: boolean;
        is_active: boolean;
        sort_order: number;
        created_at: string;
        updated_at: string;
      };
      Insert: {
        id?: string;
        canteen_id: string;
        category_id?: string | null;
        name: string;
        description?: string;
        price_paise: number;
        image_url?: string | null;
        is_veg?: boolean;
        is_available?: boolean;
        is_active?: boolean;
        sort_order?: number;
        created_at?: string;
        updated_at?: string;
      };
      Update: {
        id?: string;
        canteen_id?: string;
        category_id?: string | null;
        name?: string;
        description?: string;
        price_paise?: number;
        image_url?: string | null;
        is_veg?: boolean;
        is_available?: boolean;
        is_active?: boolean;
        sort_order?: number;
        created_at?: string;
        updated_at?: string;
      };
      Relationships: [
        {
          foreignKeyName: 'menu_items_canteen_id_fkey';
          columns: ['canteen_id'];
          isOneToOne: false;
          referencedRelation: 'canteens';
          referencedColumns: ['id'];
        },
        {
          foreignKeyName: 'menu_items_category_id_fkey';
          columns: ['category_id'];
          isOneToOne: false;
          referencedRelation: 'food_categories';
          referencedColumns: ['id'];
        },
      ];
    };
    notifications: {
      Row: {
        id: string;
        user_id: string;
        audience: string;
        type: string;
        order_id: string | null;
        status: string | null;
        read_at: string | null;
        created_at: string;
      };
      Insert: {
        id?: string;
        user_id: string;
        audience: string;
        type?: string;
        order_id?: string | null;
        status?: string | null;
        read_at?: string | null;
        created_at?: string;
      };
      Update: {
        id?: string;
        user_id?: string;
        audience?: string;
        type?: string;
        order_id?: string | null;
        status?: string | null;
        read_at?: string | null;
        created_at?: string;
      };
      Relationships: [
        {
          foreignKeyName: 'notifications_order_id_fkey';
          columns: ['order_id'];
          isOneToOne: false;
          referencedRelation: 'orders';
          referencedColumns: ['id'];
        },
        {
          foreignKeyName: 'notifications_user_id_fkey';
          columns: ['user_id'];
          isOneToOne: false;
          referencedRelation: 'profiles';
          referencedColumns: ['id'];
        },
      ];
    };
    order_items: {
      Row: {
        id: string;
        order_id: string;
        menu_item_id: string | null;
        name_snapshot: string;
        is_veg: boolean;
        unit_price_paise: number;
        quantity: number;
        line_total_paise: number;
      };
      Insert: {
        id?: string;
        order_id: string;
        menu_item_id?: string | null;
        name_snapshot: string;
        is_veg?: boolean;
        unit_price_paise: number;
        quantity: number;
        line_total_paise: number;
      };
      Update: {
        id?: string;
        order_id?: string;
        menu_item_id?: string | null;
        name_snapshot?: string;
        is_veg?: boolean;
        unit_price_paise?: number;
        quantity?: number;
        line_total_paise?: number;
      };
      Relationships: [
        {
          foreignKeyName: 'order_items_menu_item_id_fkey';
          columns: ['menu_item_id'];
          isOneToOne: false;
          referencedRelation: 'menu_items';
          referencedColumns: ['id'];
        },
        {
          foreignKeyName: 'order_items_order_id_fkey';
          columns: ['order_id'];
          isOneToOne: false;
          referencedRelation: 'orders';
          referencedColumns: ['id'];
        },
      ];
    };
    order_status_history: {
      Row: {
        id: number;
        order_id: string;
        from_status: string | null;
        to_status: string;
        actor: string;
        actor_id: string | null;
        reason: string | null;
        created_at: string;
      };
      Insert: {
        id?: number;
        order_id: string;
        from_status?: string | null;
        to_status: string;
        actor: string;
        actor_id?: string | null;
        reason?: string | null;
        created_at?: string;
      };
      Update: {
        id?: number;
        order_id?: string;
        from_status?: string | null;
        to_status?: string;
        actor?: string;
        actor_id?: string | null;
        reason?: string | null;
        created_at?: string;
      };
      Relationships: [
        {
          foreignKeyName: 'order_status_history_actor_id_fkey';
          columns: ['actor_id'];
          isOneToOne: false;
          referencedRelation: 'profiles';
          referencedColumns: ['id'];
        },
        {
          foreignKeyName: 'order_status_history_order_id_fkey';
          columns: ['order_id'];
          isOneToOne: false;
          referencedRelation: 'orders';
          referencedColumns: ['id'];
        },
      ];
    };
    order_transitions: {
      Row: {
        from_status: string;
        to_status: string;
        actor: string;
      };
      Insert: {
        from_status: string;
        to_status: string;
        actor: string;
      };
      Update: {
        from_status?: string;
        to_status?: string;
        actor?: string;
      };
      Relationships: [];
    };
    orders: {
      Row: {
        id: string;
        code: string;
        student_id: string;
        canteen_id: string;
        status: string;
        canteen_name_snapshot: string;
        hostel_id: string | null;
        hostel_label: string;
        block: string;
        room: string;
        delivery_note: string;
        subtotal_paise: number;
        discount_paise: number;
        delivery_fee_paise: number;
        packaging_fee_paise: number;
        total_paise: number;
        platform_fee_paise: number;
        coupon_id: string | null;
        coupon_code_snapshot: string | null;
        delivery_partner_id: string | null;
        cancellation_reason: string | null;
        idempotency_key: string;
        created_at: string;
        updated_at: string;
      };
      Insert: {
        id?: string;
        code?: string;
        student_id: string;
        canteen_id: string;
        status?: string;
        canteen_name_snapshot: string;
        hostel_id?: string | null;
        hostel_label: string;
        block: string;
        room: string;
        delivery_note?: string;
        subtotal_paise: number;
        discount_paise?: number;
        delivery_fee_paise?: number;
        packaging_fee_paise?: number;
        total_paise: number;
        platform_fee_paise?: number;
        coupon_id?: string | null;
        coupon_code_snapshot?: string | null;
        delivery_partner_id?: string | null;
        cancellation_reason?: string | null;
        idempotency_key: string;
        created_at?: string;
        updated_at?: string;
      };
      Update: {
        id?: string;
        code?: string;
        student_id?: string;
        canteen_id?: string;
        status?: string;
        canteen_name_snapshot?: string;
        hostel_id?: string | null;
        hostel_label?: string;
        block?: string;
        room?: string;
        delivery_note?: string;
        subtotal_paise?: number;
        discount_paise?: number;
        delivery_fee_paise?: number;
        packaging_fee_paise?: number;
        total_paise?: number;
        platform_fee_paise?: number;
        coupon_id?: string | null;
        coupon_code_snapshot?: string | null;
        delivery_partner_id?: string | null;
        cancellation_reason?: string | null;
        idempotency_key?: string;
        created_at?: string;
        updated_at?: string;
      };
      Relationships: [
        {
          foreignKeyName: 'order_partner_belongs_to_canteen';
          columns: ['delivery_partner_id', 'canteen_id'];
          isOneToOne: false;
          referencedRelation: 'delivery_partners';
          referencedColumns: ['profile_id', 'canteen_id'];
        },
        {
          foreignKeyName: 'orders_canteen_id_fkey';
          columns: ['canteen_id'];
          isOneToOne: false;
          referencedRelation: 'canteens';
          referencedColumns: ['id'];
        },
        {
          foreignKeyName: 'orders_coupon_id_fkey';
          columns: ['coupon_id'];
          isOneToOne: false;
          referencedRelation: 'coupons';
          referencedColumns: ['id'];
        },
        {
          foreignKeyName: 'orders_delivery_partner_id_fkey';
          columns: ['delivery_partner_id'];
          isOneToOne: false;
          referencedRelation: 'profiles';
          referencedColumns: ['id'];
        },
        {
          foreignKeyName: 'orders_hostel_id_fkey';
          columns: ['hostel_id'];
          isOneToOne: false;
          referencedRelation: 'hostels';
          referencedColumns: ['id'];
        },
        {
          foreignKeyName: 'orders_student_id_fkey';
          columns: ['student_id'];
          isOneToOne: false;
          referencedRelation: 'profiles';
          referencedColumns: ['id'];
        },
      ];
    };
    payments: {
      Row: {
        id: string;
        order_id: string;
        method: string;
        status: string;
        amount_paise: number;
        provider_order_id: string | null;
        provider_payment_id: string | null;
        failure_reason: string | null;
        paid_at: string | null;
        refunded_at: string | null;
        created_at: string;
        updated_at: string;
      };
      Insert: {
        id?: string;
        order_id: string;
        method: string;
        status: string;
        amount_paise: number;
        provider_order_id?: string | null;
        provider_payment_id?: string | null;
        failure_reason?: string | null;
        paid_at?: string | null;
        refunded_at?: string | null;
        created_at?: string;
        updated_at?: string;
      };
      Update: {
        id?: string;
        order_id?: string;
        method?: string;
        status?: string;
        amount_paise?: number;
        provider_order_id?: string | null;
        provider_payment_id?: string | null;
        failure_reason?: string | null;
        paid_at?: string | null;
        refunded_at?: string | null;
        created_at?: string;
        updated_at?: string;
      };
      Relationships: [
        {
          foreignKeyName: 'payments_order_id_fkey';
          columns: ['order_id'];
          isOneToOne: false;
          referencedRelation: 'orders';
          referencedColumns: ['id'];
        },
      ];
    };
    platform_settings: {
      Row: {
        key: string;
        value: Json;
        updated_at: string;
      };
      Insert: {
        key: string;
        value: Json;
        updated_at?: string;
      };
      Update: {
        key?: string;
        value?: Json;
        updated_at?: string;
      };
      Relationships: [];
    };
    profiles: {
      Row: {
        id: string;
        role: string;
        full_name: string;
        phone: string | null;
        avatar_url: string | null;
        is_active: boolean;
        created_at: string;
        updated_at: string;
        default_hostel_id: string | null;
        default_block: string | null;
        default_room: string | null;
      };
      Insert: {
        id: string;
        role?: string;
        full_name?: string;
        phone?: string | null;
        avatar_url?: string | null;
        is_active?: boolean;
        created_at?: string;
        updated_at?: string;
        default_hostel_id?: string | null;
        default_block?: string | null;
        default_room?: string | null;
      };
      Update: {
        id?: string;
        role?: string;
        full_name?: string;
        phone?: string | null;
        avatar_url?: string | null;
        is_active?: boolean;
        created_at?: string;
        updated_at?: string;
        default_hostel_id?: string | null;
        default_block?: string | null;
        default_room?: string | null;
      };
      Relationships: [
        {
          foreignKeyName: 'profiles_default_hostel_id_fkey';
          columns: ['default_hostel_id'];
          isOneToOne: false;
          referencedRelation: 'hostels';
          referencedColumns: ['id'];
        },
        {
          foreignKeyName: 'profiles_id_fkey';
          columns: ['id'];
          isOneToOne: false;
          referencedRelation: 'users';
          referencedColumns: ['id'];
        },
      ];
    };
    reviews: {
      Row: {
        id: string;
        order_id: string;
        student_id: string;
        canteen_id: string;
        food_rating: number;
        delivery_rating: number | null;
        comment: string;
        created_at: string;
      };
      Insert: {
        id?: string;
        order_id: string;
        student_id: string;
        canteen_id: string;
        food_rating: number;
        delivery_rating?: number | null;
        comment?: string;
        created_at?: string;
      };
      Update: {
        id?: string;
        order_id?: string;
        student_id?: string;
        canteen_id?: string;
        food_rating?: number;
        delivery_rating?: number | null;
        comment?: string;
        created_at?: string;
      };
      Relationships: [
        {
          foreignKeyName: 'reviews_canteen_id_fkey';
          columns: ['canteen_id'];
          isOneToOne: false;
          referencedRelation: 'canteens';
          referencedColumns: ['id'];
        },
        {
          foreignKeyName: 'reviews_order_id_fkey';
          columns: ['order_id'];
          isOneToOne: false;
          referencedRelation: 'orders';
          referencedColumns: ['id'];
        },
        {
          foreignKeyName: 'reviews_student_id_fkey';
          columns: ['student_id'];
          isOneToOne: false;
          referencedRelation: 'profiles';
          referencedColumns: ['id'];
        },
      ];
    };
    support_tickets: {
      Row: {
        id: string;
        student_id: string;
        order_id: string | null;
        subject: string;
        body: string;
        status: string;
        resolution: string | null;
        created_at: string;
        updated_at: string;
      };
      Insert: {
        id?: string;
        student_id: string;
        order_id?: string | null;
        subject: string;
        body?: string;
        status?: string;
        resolution?: string | null;
        created_at?: string;
        updated_at?: string;
      };
      Update: {
        id?: string;
        student_id?: string;
        order_id?: string | null;
        subject?: string;
        body?: string;
        status?: string;
        resolution?: string | null;
        created_at?: string;
        updated_at?: string;
      };
      Relationships: [
        {
          foreignKeyName: 'support_tickets_order_id_fkey';
          columns: ['order_id'];
          isOneToOne: false;
          referencedRelation: 'orders';
          referencedColumns: ['id'];
        },
        {
          foreignKeyName: 'support_tickets_student_id_fkey';
          columns: ['student_id'];
          isOneToOne: false;
          referencedRelation: 'profiles';
          referencedColumns: ['id'];
        },
      ];
    };
    };
    Views: {
    canteen_stats: {
      Row: {
        canteen_id: string | null;
        avg_food_rating: number | null;
        review_count: number | null;
        median_prep_minutes: number | null;
        prep_sample_size: number | null;
      };
      Relationships: [];
    };
    canteens_public: {
      Row: {
        id: string | null;
        name: string | null;
        description: string | null;
        image_url: string | null;
        opens_at: string | null;
        closes_at: string | null;
        min_order_paise: number | null;
        phone: string | null;
        is_open: boolean | null;
        is_accepting_orders: boolean | null;
      };
      Relationships: [];
    };
    revenue_by_canteen_day: {
      Row: {
        day: string | null;
        canteen_id: string | null;
        canteen_name: string | null;
        orders: number | null;
        gross_subtotal_paise: number | null;
        discounts_paise: number | null;
        delivery_fees_paise: number | null;
        packaging_fees_paise: number | null;
        students_paid_paise: number | null;
        platform_fee_paise: number | null;
        canteen_received_paise: number | null;
      };
      Relationships: [];
    };
    };
    Functions: {
    admin_attach_canteen_staff: {
      Args: {
        p_profile_id: string | null;
        p_canteen_id: string | null;
      };
      Returns: undefined;
    };
    admin_create_canteen: {
      Args: {
        p_name: string | null;
        p_description: string | null;
        p_phone: string | null;
        p_image_url: string | null;
        p_min_order_paise: number | null;
        p_opens_at: string | null;
        p_closes_at: string | null;
      };
      Returns: string;
    };
    admin_detach_canteen_staff: {
      Args: {
        p_profile_id: string | null;
        p_canteen_id: string | null;
      };
      Returns: undefined;
    };
    admin_set_canteen_active: {
      Args: {
        p_canteen_id: string | null;
        p_active: boolean | null;
      };
      Returns: undefined;
    };
    admin_set_partner_active: {
      Args: {
        p_profile_id: string | null;
        p_canteen_id: string | null;
        p_active: boolean | null;
      };
      Returns: undefined;
    };
    admin_set_partner_canteen: {
      Args: {
        p_profile_id: string | null;
        p_canteen_id: string | null;
        p_approved?: boolean | null;
      };
      Returns: undefined;
    };
    admin_set_profile_active: {
      Args: {
        p_profile_id: string | null;
        p_active: boolean | null;
      };
      Returns: undefined;
    };
    admin_set_role: {
      Args: {
        p_profile_id: string | null;
        p_role: string | null;
      };
      Returns: undefined;
    };
    admin_update_canteen: {
      Args: {
        p_canteen_id: string | null;
        p_name: string | null;
        p_description: string | null;
        p_phone: string | null;
        p_image_url: string | null;
        p_min_order_paise: number | null;
        p_opens_at: string | null;
        p_closes_at: string | null;
        p_is_accepting_orders: boolean | null;
      };
      Returns: undefined;
    };
    auth_role: {
      Args: Record<PropertyKey, never>;
      Returns: string;
    };
    campus_now: {
      Args: Record<PropertyKey, never>;
      Returns: string;
    };
    canteen_set_partner_active: {
      Args: {
        p_profile_id: string | null;
        p_active: boolean | null;
      };
      Returns: undefined;
    };
    claim_delivery: {
      Args: {
        p_order_id: string | null;
      };
      Returns: string;
    };
    is_admin: {
      Args: Record<PropertyKey, never>;
      Returns: boolean;
    };
    is_delivery_partner: {
      Args: Record<PropertyKey, never>;
      Returns: boolean;
    };
    is_within_hours: {
      Args: {
        p_opens: string | null;
        p_closes: string | null;
        p_at: string | null;
      };
      Returns: boolean;
    };
    my_canteen_id: {
      Args: Record<PropertyKey, never>;
      Returns: string;
    };
    my_delivery_canteen_id: {
      Args: Record<PropertyKey, never>;
      Returns: string;
    };
    notify_order: {
      Args: {
        p_order_id: string | null;
        p_status: string | null;
        p_audiences: string[] | null;
      };
      Returns: undefined;
    };
    place_order: {
      Args: {
        p_canteen_id: string | null;
        p_items: Json | null;
        p_hostel_id: string | null;
        p_block: string | null;
        p_room: string | null;
        p_idempotency_key: string | null;
        p_note?: string | null;
        p_coupon_code?: string | null;
        p_payment_method?: string | null;
      };
      Returns: string;
    };
    release_delivery: {
      Args: {
        p_order_id: string | null;
      };
      Returns: string;
    };
    setting_int: {
      Args: {
        p_key: string | null;
        p_default: number | null;
      };
      Returns: number;
    };
    transition_order: {
      Args: {
        p_order_id: string | null;
        p_to: string | null;
        p_reason?: string | null;
      };
      Returns: string;
    };
    };
    Enums: Record<PropertyKey, never>;
    CompositeTypes: Record<PropertyKey, never>;
  };
};

type PublicSchema = Database['public'];

/** Row type of a table or view, e.g. `Row<'orders'>`. */
export type Row<T extends keyof (PublicSchema['Tables'] & PublicSchema['Views'])> =
  (PublicSchema['Tables'] & PublicSchema['Views'])[T] extends { Row: infer R } ? R : never;

/** Insert type of a table, e.g. `Insert<'reviews'>`. */
export type Insert<T extends keyof PublicSchema['Tables']> =
  PublicSchema['Tables'][T] extends { Insert: infer I } ? I : never;

/** Update type of a table, e.g. `Update<'profiles'>`. */
export type Update<T extends keyof PublicSchema['Tables']> =
  PublicSchema['Tables'][T] extends { Update: infer U } ? U : never;
