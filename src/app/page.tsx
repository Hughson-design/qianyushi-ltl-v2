"use client";
import { BookingReleaseDialog } from "./booking-release-dialog";
import { AdminDepositOverview } from "./admin-deposit-overview";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { CompanyAccount } from "./company-account";
import { ShipmentReaderPanel } from "./shipment-reader-panel";
import { MyAccount } from "./my-account";
import { QuoteInputHistory } from "./quote-input-history";
import { CustomerWorkspaces } from "./customer-workspaces";
import { formatPhoneInput } from "@/lib/phone";
import { AdminUserEditor } from "./admin-user-editor";
import { printBol, printShippingLabel } from "./print-bol";
import { calculateDensityClass, missingDimensionUnit, parseSmartQuote, SmartQuoteResult } from "@/lib/smart-quote-parser";

type DeliveryClassification = "residential" | "business" | "unknown" | "unavailable";

async function classifyDeliveryAddress(address: string, zip: string): Promise<DeliveryClassification> {
  if (!/\d/.test(address.replace(/\b\d{5}(?:-\d{4})?\b/g, "")) || !/^\d{5}$/.test(zip)) return "unknown";
  try {
    const response = await fetch("/api/locations/validate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ address, zip }),
      signal: AbortSignal.timeout(4000),
    });
    if (!response.ok) return "unavailable";
    const { classification } = await response.json();
    return classification === "residential" || classification === "business" || classification === "unknown" ? classification : "unavailable";
  } catch {
    return "unavailable";
  }
}

type FreightItem = {
  id: number;
  packaging: string;
  stackable: boolean;
  pallets: string;
  pieces: string;
  nmfc: string;
  length: string;
  width: string;
  height: string;
  unitWeight: string;
  hazmat: boolean;
  commodity: string;
  declaredValue: string;
};

const rateProviderLabels = { priority1: "Priority1", tql: "TQL", wwex: "WWEX", mothership: "Mothership" } as const;
type RateProvider = keyof typeof rateProviderLabels;
type RateProgress = { status: "pending" | "done" | "empty" | "failed" | "disabled"; elapsedMs?: number };

type Rate = {
  quoteToken: string;
  carrier: string;
  service: string;
  transit: string;
  price: number;
  badge?: string;
  provider?: "wwex" | "priority1" | "tql" | "mothership";
  providerRef?: Record<string, string | number>;
};

type SavedQuote = {
  id: string;
  quote_number: string;
  status: "draft" | "booking" | "booked" | "void";
  reference: string;
  origin_zip: string;
  destination_zip: string;
  ready_date: string | null;
  carrier: string;
  service: string;
  transit: string;
  price: number | string;
  provider: "priority1" | "wwex" | "tql";
  receiver: BookingParty;
  sender: BookingParty;
  freight_items: Array<FreightItem & { totalWeight?: number; freightClass?: string }>;
  services: string[];
  pickup_ready_time?: string;
  pickup_close_time?: string;
  bol_number: string | null;
  bol_url: string | null;
  created_at: string;
};

type BookingParty = {
  company: string;
  country: string;
  address1: string;
  address2: string;
  zip: string;
  state: string;
  city: string;
  phone: string;
  extension: string;
  contact: string;
  email: string;
  save: string;
  deliveryStartTime?: string;
  deliveryEndTime?: string;
};

type AddressCategory = "sender" | "receiver" | "both";

type AddressBookEntry = Omit<BookingParty, "save"> & {
  category?: AddressCategory | null;
  id: string;
  created_at: string;
  updated_at: string;
};

type AddressBookTarget = "route-origin" | "route-destination" | "sender" | "receiver";
type View = "reader" | "new" | "quotes" | "orders" | "addresses" | "deposit" | "customers" | "settings" | "account" | "quote-inputs";

type AuthUser = {
  userId: string;
  customerId: string | null;
  customerName: string;
  email: string;
  name: string;
  role: "admin" | "operations" | "sales" | "customer_admin" | "customer";
  canSelfBook: boolean;
  legacy?: boolean;
};

type Customer = {
  id: string;
  name: string;
  code: string;
  active: boolean;
  is_internal: boolean;
  can_self_book: boolean;
  markup_percent: number;
  minimum_markup: number;
  app_users: Array<{ user_id: string; email: string; full_name: string; role: string; active: boolean }>;
};

type DepositTransaction = {
  id: string;
  transaction_type: "DEPOSIT" | "ADJUSTMENT" | "BOL_RESERVE" | "BOOKING_RELEASE" | "VOID_REFUND";
  amount: number | string;
  balance_after: number | string;
  created_at: string;
  reason?: string;
  saved_quotes: { quote_number: string; reference: string } | null;
};

type PlatformSettings = {
  company_name: string;
  contact_name: string;
  email: string;
  phone: string;
  default_ready_time: string;
  default_close_time: string;
  markup_percent: number;
  minimum_markup: number;
  wwex_enabled: boolean;
  priority1_enabled: boolean;
  tql_enabled: boolean;
  mothership_enabled: boolean;
};

const blankBookingParty: BookingParty = {
  company: "",
  country: "United States",
  address1: "",
  address2: "",
  zip: "",
  state: "",
  city: "",
  phone: "",
  extension: "",
  contact: "",
  email: "",
  save: "no",
};

function bookingPartyFromAddress(address: string, zip: string): Partial<BookingParty> {
  const clean = address.replace(/\s*·.*$/, "").replace(new RegExp(`\\s*${zip}\\s*$`), "").replace(/,\s*$/, "").trim();
  const parts = clean.split(",").map((part) => part.trim()).filter(Boolean);
  const state = parts.at(-1)?.match(/\b[A-Z]{2}\b/i)?.[0]?.toUpperCase() || "";
  return {
    address1: parts.length >= 3 ? parts.slice(0, -2).join(", ") : "",
    city: parts.length >= 2 ? parts.at(-2) || "" : parts[0] || "",
    state,
    zip,
  };
}

const initialItem: FreightItem = {
  id: 1,
  packaging: "Pallet",
  stackable: true,
  pallets: "1",
  pieces: "1",
  nmfc: "",
  length: "48",
  width: "40",
  height: "48",
  unitWeight: "500",
  hazmat: false,
  commodity: "",
  declaredValue: "",
};

const services = ["Liftgate at pickup", "Liftgate at delivery", "Residential pickup", "Residential delivery", "Limited access", "Appointment delivery", "Overlength freight"];

const chineseTranslations: Record<string, string> = {
  "WORKSPACE": "工作台", "ACCOUNT": "账户", "New quote": "新建报价", "Quotes": "报价", "Orders": "订单", "Address book": "地址簿", "Customers": "客户", "Deposit": "押金", "Settings": "设置", "Sign out": "退出登录",
  "CREATE SHIPMENT": "创建运输", "Get an LTL quote": "获取 LTL 报价", "Available deposit": "可用押金", "View activity →": "查看明细 →",
  "SMART QUOTE": "智能报价", "Paste shipment details to autofill": "粘贴货物资料并自动填写", "Line 1: sender. Line 2: receiver. Line 3 and after: one freight item per line. Commercial, residential, liftgate, and appointment keywords are recognized automatically.": "第一行填写发货地址，第二行填写收货地址，第三行起每行填写一项货物。系统可自动识别商业、住宅、尾门和预约等关键词。", "Autofill": "帮我填写",
  "Route": "路线", "Where is the freight moving?": "货物从哪里运到哪里？", "SHIP FROM": "发货地", "SHIP TO": "收货地", "Address category": "地址分类", "Choose at least one address category.": "请至少勾选一个地址分类。", "Shipper and consignee": "发货人及收货人", "Uncategorized": "未分类", "READY DATE (PT)": "发货日期（美国太平洋时间）",
  "Freight details": "货物详情", "All dimensions use inches and all weights use pounds.": "尺寸统一使用英寸，重量统一使用磅。", "LINE": "货物行", "Remove": "删除", "Packaging": "包装类型", "Select": "请选择", "Carton": "硬纸箱", "Crate": "木箱", "Bale": "捆包", "Roll": "卷", "Pallet": "托盘", "Loose": "未打托", "Stackable": "可堆叠", "Yes": "是", "No": "否", "Pallets": "托数", "Length": "长", "Width": "宽", "Height": "高", "Unit weight": "单托重量", "Total weight": "总重量", "Hazmat": "危险品", "Commodity": "英文品名", "Declared value": "货值", "Add another handling unit": "增加一项货物",
  "Additional services": "附加服务", "Liftgate at pickup": "提货尾门", "Liftgate at delivery": "派送尾门", "Residential pickup": "住宅提货", "Residential delivery": "住宅派送", "Limited access": "受限地点", "Appointment delivery": "预约派送", "Overlength freight": "超长货物", "Your rates are private": "报价仅您可见", "Customers only see the final selling price.": "客户只会看到最终销售价格。", "Get rates": "获取报价", "Comparing carriers…": "正在比较承运商…",
  "QUOTE RESULTS": "报价结果", "Choose a rate": "选择报价", "Transit days": "预计运输天数", "Not provided": "未提供", "Customer price": "客户价格", "Lowest price": "最低价格", "Fastest": "最快", "Deposit after BOL": "生成 BOL 后押金余额", "Continue to booking →": "继续填写下单资料 →",
  "BOOKING DETAILS": "下单资料", "Complete shipment contacts": "完善运输联系人资料", "Ship date": "发货日期", "Ready time": "提货开始时间", "Close time": "提货截止时间", "Skip address verification": "跳过地址验证", "Shipper": "发货人", "Consignee": "收货人", "Clear all": "清空", "Company or name": "公司或姓名", "Country": "国家", "Address 1": "地址 1", "Address 2": "地址 2", "Optional": "选填", "Postal code": "邮编", "State / Prov": "州", "City": "城市", "Phone number": "电话", "Extension": "分机", "Contact name": "联系人", "Email": "邮箱", "Save": "保存", "Do not save": "不保存", "Save to address book": "保存到地址簿", "Reference / PO": "Reference / PO", "Save booking details": "保存下单资料", "Generate BOL": "生成 BOL", "BOL approval required": "需要批准后才能生成 BOL",
  "SAVED QUOTES": "已保存报价", "Saved booking details and selected carrier rates appear here.": "已保存的下单资料和承运商报价显示在这里。", "Loading quotes…": "正在加载报价…", "No matching quotes.": "没有符合条件的报价。", "No saved quotes yet.": "暂时没有已保存报价。", "Try another search.": "请尝试其他搜索条件。", "Quote": "报价单", "Customer": "客户", "Carrier": "承运商", "Status": "状态", "Price": "价格", "Action": "操作", "Download BOL": "下载 BOL", "Void shipment": "取消运单", "Copy & requote": "复制并重新报价", "View details": "查看详情",
  "SHIPMENTS": "运输订单", "Generated BOLs and cancelled shipments appear here.": "已生成 BOL 和已取消的运输订单显示在这里。", "Loading orders…": "正在加载订单…", "No matching orders.": "没有符合条件的订单。", "No orders yet.": "暂时没有订单。", "Pickup cancelled": "Pickup 已取消",
  "SAVED LOCATIONS": "已保存地址", "Manage frequently used sender and receiver addresses.": "管理常用的发货与收货地址。", "Add address": "添加地址", "Edit address": "编辑地址", "State": "州", "Contact": "联系人", "Phone": "电话", "Save address": "保存地址", "Update address": "更新地址", "Cancel": "取消", "Saved addresses": "已保存地址", "Loading addresses…": "正在加载地址…", "No saved addresses yet.": "暂时没有已保存地址。", "Edit": "编辑", "Delete": "删除",
  "ACCOUNT BALANCE": "账户余额", "BOL charges and void refunds are recorded automatically.": "生成 BOL 的扣款和取消运单的退款会自动记录。", "Available balance": "可用余额", "Manual adjustment": "手工调整", "Use a positive amount for a customer payment and a negative amount for a correction.": "客户付款请输入正数，更正扣款请输入负数。", "Amount (USD)": "金额（美元）", "Payment reference / reason": "付款凭证 / 原因", "Apply adjustment": "确认调整", "Activity": "资金明细", "Loading activity…": "正在加载明细…", "No deposit activity yet.": "暂时没有押金记录。",
  "CUSTOMER ACCOUNTS": "客户账户", "Create customer workspaces, control pricing, and choose which customer you are working on.": "创建客户账户、设置加价并选择当前操作客户。", "Working on": "当前客户", "Add customer": "添加客户", "Customer name": "客户名称", "Customer code": "客户代码", "Markup percent": "加价百分比", "Minimum markup": "最低加价", "Customer may generate BOLs": "允许客户生成 BOL", "First login user": "首位登录用户", "Name": "姓名", "Temporary password": "临时密码", "Create customer": "创建客户", "Add login user": "添加登录用户", "Role": "角色", "Create login user": "创建登录用户", "Customer workspaces": "客户账户", "Active": "启用", "May generate BOL": "允许生成 BOL", "Login users": "登录用户", "Save user": "保存用户", "New password": "新密码", "Initialize password": "初始化密码",
  "PLATFORM DEFAULTS": "平台默认设置", "These defaults are applied when preparing new bookings.": "创建新订单时会自动使用这些默认设置。", "Company name": "公司名称", "Default contact": "默认联系人", "Default ready time": "默认提货开始时间", "Default close time": "默认提货截止时间", "Customer pricing": "客户价格", "Minimum markup (USD)": "最低加价（美元）", "Rate providers": "报价渠道", "Save settings": "保存设置",
  "Create administrator": "创建管理员", "Sign in": "登录", "Opening your workspace…": "正在打开工作台…", "Checking the secure workspace.": "正在检查安全登录状态。", "Administrator name": "管理员姓名", "Password": "密码", "Please wait…": "请稍候…", "Administrator": "管理员", "Operations": "操作员", "Sales": "销售", "Select customer": "选择客户", "Total": "总计", "Freight": "货物"
};

function Icon({ children }: { children: React.ReactNode }) {
  return <span className="nav-icon" aria-hidden="true">{children}</span>;
}

export default function Home() {
  const pathname = usePathname();
  const quickQuote = pathname === "/quick-quote";
  const [language, setLanguage] = useState<"en" | "zh">("en");
  const [helpOpen, setHelpOpen] = useState(false);
  const [authState, setAuthState] = useState<"checking" | "setup" | "login" | "ready" | "signed-out">("checking");
  const [authUser, setAuthUser] = useState<AuthUser | null>(null);
  const [authForm, setAuthForm] = useState({ name: "Cathy Huang", email: "", password: "" });
  const [authError, setAuthError] = useState("");
  const [authLoading, setAuthLoading] = useState(false);
  const [view, setView] = useState<View>(pathname === "/shipment-reader" ? "reader" : "new");
  const [accountBack, setAccountBack] = useState<View>("new");
  const [adminEditId, setAdminEditId] = useState<string | null>(null);
  const [items, setItems] = useState<FreightItem[]>([initialItem]);
  const [selectedServices, setSelectedServices] = useState<string[]>([]);
  const [rates, setRates] = useState<Rate[]>([]);
  const [selectedRate, setSelectedRate] = useState<number | null>(null);
  const [bookingOpen, setBookingOpen] = useState(false);
  const [bookingMessage, setBookingMessage] = useState("");
  const [savingBooking, setSavingBooking] = useState(false);
  const [savedQuotes, setSavedQuotes] = useState<SavedQuote[]>([]);
  const [savedQuotesLoading, setSavedQuotesLoading] = useState(false);
  const [savedQuotesError, setSavedQuotesError] = useState("");
  const [savedQuotesNotice, setSavedQuotesNotice] = useState("");
  const [historySearch, setHistorySearch] = useState("");
  const [selectedOrder, setSelectedOrder] = useState<SavedQuote | null>(null);
  const [quoteActionId, setQuoteActionId] = useState<string | null>(null);
  const [bookingCities, setBookingCities] = useState<{ sender: string[]; receiver: string[] }>({ sender: [], receiver: [] });
  const [zipStatus, setZipStatus] = useState<{ sender: string; receiver: string }>({ sender: "", receiver: "" });
  const [addressBookTarget, setAddressBookTarget] = useState<AddressBookTarget | null>(null);
  const [addressBookEntries, setAddressBookEntries] = useState<AddressBookEntry[]>([]);
  const [addressBookLoading, setAddressBookLoading] = useState(false);
  const [addressBookError, setAddressBookError] = useState("");
  const [deletingAddressId, setDeletingAddressId] = useState<string | null>(null);
  const [addressPageMessage, setAddressPageMessage] = useState("");
  const [savingAddress, setSavingAddress] = useState(false);
  const [editingAddressId, setEditingAddressId] = useState<string | null>(null);
  const [addressCategory, setAddressCategory] = useState<AddressCategory | "">("");
  const [newAddress, setNewAddress] = useState<BookingParty>({ ...blankBookingParty });
  const [depositTransactions, setDepositTransactions] = useState<DepositTransaction[]>([]);
  const [depositOverviewVersion, setDepositOverviewVersion] = useState(0);
  const [depositLoading, setDepositLoading] = useState(false);
  const [depositError, setDepositError] = useState("");
  const [settings, setSettings] = useState<PlatformSettings>({
    company_name: "Shenzhen Qianyushi Supply Chain Service Co.,Ltd.",
    contact_name: "Cathy Huang",
    email: "",
    phone: "",
    default_ready_time: "09:00",
    default_close_time: "16:00",
    markup_percent: 0,
    minimum_markup: 0,
    wwex_enabled: true,
    priority1_enabled: true,
    tql_enabled: false,
    mothership_enabled: true,
  });
  const [settingsLoading, setSettingsLoading] = useState(false);
  const [settingsMessage, setSettingsMessage] = useState("");
  const [settingsError, setSettingsError] = useState("");
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [customersLoading, setCustomersLoading] = useState(false);
  const [customersError, setCustomersError] = useState("");
  const [customersNotice, setCustomersNotice] = useState("");
  const [releaseQuoteId, setReleaseQuoteId] = useState<string | null>(null);
  const [pendingBolQuote, setPendingBolQuote] = useState<SavedQuote | null>(null);
  const [customerForm, setCustomerForm] = useState({ name: "", code: "", markupPercent: "0", minimumMarkup: "0", canSelfBook: true, userName: "", email: "", password: "" });
  const [userForm, setUserForm] = useState({ customerId: "", fullName: "", email: "", password: "", role: "customer" });
  const [bookingDetails, setBookingDetails] = useState({
    sender: { ...blankBookingParty },
    receiver: { ...blankBookingParty },
    reference: "",
    skipAddressVerification: false,
  });
  const [loading, setLoading] = useState(false);
  const [rateProgress, setRateProgress] = useState<Partial<Record<RateProvider, RateProgress>>>({});
  const [quoteMessage, setQuoteMessage] = useState("");
  const [origin, setOrigin] = useState("91761");
  const [destination, setDestination] = useState("75247");
  const [originAddress, setOriginAddress] = useState("Ontario, CA · Commercial");
  const [destinationAddress, setDestinationAddress] = useState("Dallas, TX · Commercial");
  const [readyDate, setReadyDate] = useState("");

  useEffect(() => {
    const formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/Los_Angeles",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    const parts = formatter.formatToParts(new Date());
    const today = ["year", "month", "day"]
      .map((type) => parts.find((part) => part.type === type)?.value)
      .join("-");
    setReadyDate((date) => date || today);
  }, []);

  const [pickupReadyTime, setPickupReadyTime] = useState("09:00");
  const [pickupCloseTime, setPickupCloseTime] = useState("16:00");
  const smartQuoteExample = "Commercial, loading dock, 13602 12th St Unit B, Chino, CA 91710\nResidential, liftgate, appointment, 650 Boulder Drive, Breinigsville, PA 18031\n1 pallet, 110×96×65cm, 177kg, commodity: Furniture\n1 crate, 120×100×180cm, 500kg, non-stackable, commodity: Electronics";
  const [smartText, setSmartText] = useState(quickQuote ? "" : smartQuoteExample);
  const [smartResult, setSmartResult] = useState<SmartQuoteResult | null>(null);
  const [deliveryCheck, setDeliveryCheck] = useState<{ address: string; zip: string; classification: DeliveryClassification } | null>(null);
  const [checkingDelivery, setCheckingDelivery] = useState(false);
  const [quickResidential, setQuickResidential] = useState<boolean | null>(null);
  const deliveryCheckRequest = useRef(0);
  const autoResidential = useRef(false);
  const [deposit, setDeposit] = useState(0);

  const pickerCategory = addressBookTarget === "sender" || addressBookTarget === "route-origin" ? "sender" : "receiver";
  const pickerAddresses = addressBookEntries.filter((entry) => !entry.category || entry.category === "both" || entry.category === pickerCategory);
  const tx = (english: string) => language === "zh" ? chineseTranslations[english] || english : english;
  const statusLabel = (status: string) => language === "zh" ? ({ draft: "草稿", booking: "待核对（押金已预留）", booked: "已生成 BOL", void: "已取消" }[status] || status) : status;
  const helpItems = language === "zh" ? [
    { title: "1. 智能报价", body: "第一行粘贴发货地址，第二行粘贴收货地址，第三行起每行填写一项货物。点击“帮我填写”后，请检查系统识别的地址、附加服务和货物资料。" },
    { title: "2. 路线和货物", body: "尺寸统一使用 inch，重量统一使用 lb。总重量和 Class 会自动计算，无法手工修改。" },
    { title: "3. 获取报价", body: "确认路线、货物和附加服务后点击“获取报价”，选择合适的承运商价格，再继续填写下单资料。" },
    { title: "4. Booking 与 BOL", body: "补全发货人、收货人、联系人和提货时间。保存资料只会建立草稿；点击“生成 BOL”会同时向承运商预约 Pickup，并从客户押金中扣除相应费用。" },
    { title: "5. 取消运单", body: "在报价或订单页面点击“取消运单”，系统会尝试取消承运商运单和 Pickup；成功后，原先扣除的押金会退回。" },
    { title: "6. 地址簿与押金", body: "常用发货和收货地址可保存到地址簿。押金页面显示充值、BOL 扣款和取消退款记录。" },
  ] : [
    { title: "1. Smart quote", body: "Paste the sender on line 1, receiver on line 2, and one freight item per line after that. Select Autofill, then review the recognized addresses, services, and freight." },
    { title: "2. Route and freight", body: "Dimensions use inches and weights use pounds. Total weight and Class are calculated automatically and cannot be edited." },
    { title: "3. Get rates", body: "Confirm the route, freight, and additional services, select Get rates, then choose a carrier rate and continue to booking." },
    { title: "4. Booking and BOL", body: "Complete the sender, receiver, contacts, and pickup times. Saving creates a draft only. Generate BOL also schedules the carrier Pickup and deducts the charge from the customer deposit." },
    { title: "5. Void shipment", body: "Void shipment attempts to cancel both the carrier shipment and Pickup. When successful, the original deposit charge is refunded." },
    { title: "6. Address book and deposit", body: "Save frequently used sender and receiver locations in the address book. Deposit shows payments, BOL charges, and void refunds." },
  ];

  function toggleLanguage() {
    setLanguage((current) => {
      const next = current === "en" ? "zh" : "en";
      window.localStorage.setItem("ltl-language", next);
      return next;
    });
  }

  useEffect(() => {
    if (window.localStorage.getItem("ltl-language") === "zh") setLanguage("zh");
    void checkSession();
  }, []);

  useEffect(() => {
    if (authState !== "ready") return;
    let checking = false;
    let disposed = false;
    async function verifySession() {
      if (checking || document.visibilityState !== "visible") return;
      checking = true;
      try {
        const response = await fetch("/api/auth/session", { cache: "no-store" });
        if (!response.ok) return;
        const session = await response.json();
        if (!disposed && !session.authenticated) {
          setAuthUser(null);
          setAuthState("signed-out");
          setAuthForm((form) => ({ ...form, password: "" }));
        }
      } catch {
        // A temporary network failure can be checked on the next poll.
      } finally {
        checking = false;
      }
    }
    const timer = window.setInterval(verifySession, 10_000);
    window.addEventListener("focus", verifySession);
    document.addEventListener("visibilitychange", verifySession);
    return () => {
      disposed = true;
      window.clearInterval(timer);
      window.removeEventListener("focus", verifySession);
      document.removeEventListener("visibilitychange", verifySession);
    };
  }, [authState]);

  async function checkSession() {
    try {
      const response = await fetch("/api/auth/session", { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Unable to check the session.");
      if (data.setupRequired) {
        setAuthState("setup");
        return;
      }
      if (!data.authenticated || !data.user) {
        setAuthState("login");
        return;
      }
      setAuthUser(data.user);
      setAuthState("ready");
      const depositResponse = await fetch("/api/deposit", { cache: "no-store" });
      if (depositResponse.ok) setDeposit(Number((await depositResponse.json()).availableBalance));
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : "Unable to check the session.");
      setAuthState("login");
    }
  }

  async function submitAuthentication(event: FormEvent) {
    event.preventDefault();
    setAuthLoading(true);
    setAuthError("");
    try {
      const endpoint = authState === "setup" ? "/api/auth/setup" : "/api/auth/login";
      const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(authForm) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Unable to continue.");
      await checkSession();
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : "Unable to continue.");
    } finally {
      setAuthLoading(false);
    }
  }

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    setAuthUser(null);
    setAuthForm((current) => ({ ...current, password: "" }));
    setAuthState("login");
  }

  const visibleRates = rates.slice(0, 5);
  const priority1Count = visibleRates.filter((rate) => rate.provider === "priority1").length;
  const tqlCount = visibleRates.filter((rate) => rate.provider === "tql").length;
  const wwexCount = visibleRates.filter((rate) => rate.provider === "wwex").length;
  const mothershipCount = visibleRates.filter((rate) => rate.provider === "mothership").length;
  const mothershipSelected = selectedRate !== null && rates[selectedRate]?.provider === "mothership";
  const selectedPrice = selectedRate === null ? 0 : rates[selectedRate]?.price ?? 0;
  const balanceAfter = useMemo(() => deposit - selectedPrice, [selectedPrice]);
  const filteredQuotes = useMemo(() => {
    const query = historySearch.trim().toLowerCase();
    if (!query) return savedQuotes;
    return savedQuotes.filter((quote) => [quote.quote_number, quote.bol_number, quote.reference, quote.origin_zip, quote.destination_zip, quote.receiver?.company, quote.carrier].some((value) => String(value || "").toLowerCase().includes(query)));
  }, [historySearch, savedQuotes]);
  const filteredOrders = useMemo(() => filteredQuotes.filter((quote) => quote.status === "booked" || quote.status === "void"), [filteredQuotes]);

  function invalidateRates(message = "Shipment details changed. Get new rates before booking.") {
    if (rates.length || selectedRate !== null || bookingOpen) setQuoteMessage(message);
    setRates([]);
    setSelectedRate(null);
    setBookingOpen(false);
  }

  function updateItem(id: number, field: keyof FreightItem, value: string | boolean) {
    setItems((current) => current.map((item) => (item.id === id ? { ...item, [field]: value } : item)));
    invalidateRates();
  }

  function addItem() {
    setItems((current) => [...current, { ...initialItem, id: Date.now(), pallets: "1" }]);
    invalidateRates();
  }

  function removeItem(id: number) {
    setItems((current) => current.length === 1 ? current : current.filter((item) => item.id !== id));
    invalidateRates();
  }

  function toggleService(service: string) {
    if (service === "Residential delivery") {
      autoResidential.current = false;
      if (checkingDelivery) clearDeliveryCheck();
    }
    setSelectedServices((current) => current.includes(service) ? current.filter((item) => item !== service) : [...current, service]);
    invalidateRates();
  }

  function clearDeliveryCheck() {
    deliveryCheckRequest.current += 1;
    setDeliveryCheck(null);
    setCheckingDelivery(false);
    if (autoResidential.current) {
      autoResidential.current = false;
      setSelectedServices((current) => current.filter((service) => service !== "Residential delivery"));
    }
  }

  function openBooking() {
    setBookingDetails((current) => ({
      ...current,
      sender: { ...current.sender, ...bookingPartyFromAddress(originAddress, origin), company: current.sender.company, phone: current.sender.phone, contact: current.sender.contact, email: current.sender.email },
      receiver: { ...current.receiver, ...bookingPartyFromAddress(destinationAddress, destination), company: current.receiver.company, phone: current.receiver.phone, contact: current.receiver.contact, email: current.receiver.email },
    }));
    setBookingOpen(true);
    setBookingMessage("");
    window.setTimeout(() => document.getElementById("booking")?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
  }

  function updateBookingParty(party: "sender" | "receiver", field: keyof BookingParty, value: string) {
    setBookingDetails((current) => ({ ...current, [party]: { ...current[party], [field]: value } }));
    if (field === "zip") {
      setBookingCities((current) => ({ ...current, [party]: [] }));
      setZipStatus((current) => ({ ...current, [party]: "" }));
      if (/^\d{5}$/.test(value)) void lookupPostalCode(party, value);
    }
  }

  function clearBookingParty(party: "sender" | "receiver") {
    setBookingDetails((current) => ({ ...current, [party]: { ...blankBookingParty } }));
    setBookingCities((current) => ({ ...current, [party]: [] }));
    setZipStatus((current) => ({ ...current, [party]: "" }));
  }

  async function lookupPostalCode(party: "sender" | "receiver", zip: string) {
    setZipStatus((current) => ({ ...current, [party]: "Looking up…" }));
    try {
      const response = await fetch(`/api/locations/${zip}`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "ZIP code not found.");
      const cities = Array.isArray(data.cities) ? data.cities.map(String) : [];
      setBookingCities((current) => ({ ...current, [party]: cities }));
      setBookingDetails((current) => ({
        ...current,
        [party]: { ...current[party], state: String(data.state || ""), city: cities[0] || "" },
      }));
      setZipStatus((current) => ({ ...current, [party]: cities.length > 1 ? `${cities.length} cities available` : "ZIP verified" }));
    } catch (error) {
      setZipStatus((current) => ({ ...current, [party]: error instanceof Error ? error.message : "ZIP lookup failed." }));
    }
  }

  async function openAddressBook(target: AddressBookTarget) {
    setAddressBookTarget(target);
    setAddressBookLoading(true);
    setAddressBookError("");
    try {
      const response = await fetch("/api/addresses", { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Unable to load the address book.");
      setAddressBookEntries(Array.isArray(data.addresses) ? data.addresses : []);
    } catch (error) {
      setAddressBookError(error instanceof Error ? error.message : "Unable to load the address book.");
    } finally {
      setAddressBookLoading(false);
    }
  }

  function chooseAddress(entry: AddressBookEntry) {
    if (!addressBookTarget) return;
    const { id: _id, created_at: _createdAt, updated_at: _updatedAt, ...address } = entry;
    if (addressBookTarget === "route-origin" || addressBookTarget === "route-destination") {
      const party = addressBookTarget === "route-origin" ? "sender" : "receiver";
      const displayAddress = `${address.address1}${address.address2 ? `, ${address.address2}` : ""}, ${address.city}, ${address.state} ${address.zip} · Saved address`;
      if (party === "sender") {
        setOrigin(address.zip);
        setOriginAddress(displayAddress);
      } else {
        clearDeliveryCheck();
        setDestination(address.zip);
        setDestinationAddress(displayAddress);
      }
      setBookingDetails((current) => ({ ...current, [party]: { ...address, save: "no" } }));
      setBookingCities((current) => ({ ...current, [party]: [address.city] }));
      setZipStatus((current) => ({ ...current, [party]: "Saved address selected" }));
      setRates([]);
      setSelectedRate(null);
      setBookingOpen(false);
      setQuoteMessage("Route updated from the address book. Get new rates for this address.");
      setAddressBookTarget(null);
      return;
    }

    const party = addressBookTarget;
    const expectedZip = party === "sender" ? origin : destination;
    if (entry.zip !== expectedZip) {
      setAddressBookError(`This rate is for ZIP ${expectedZip}. Select an address in that ZIP or start a new quote.`);
      return;
    }
    setBookingDetails((current) => ({ ...current, [party]: { ...address, save: "no" } }));
    setBookingCities((current) => ({ ...current, [party]: [address.city] }));
    setZipStatus((current) => ({ ...current, [party]: "Saved address selected" }));
    setAddressBookTarget(null);
  }

  async function deleteAddress(entry: AddressBookEntry) {
    if (!window.confirm(`Delete ${entry.company} from the address book?`)) return;
    setDeletingAddressId(entry.id);
    setAddressBookError("");
    try {
      const response = await fetch(`/api/addresses/${entry.id}`, { method: "DELETE" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Unable to delete this address.");
      setAddressBookEntries((current) => current.filter((address) => address.id !== entry.id));
    } catch (error) {
      setAddressBookError(error instanceof Error ? error.message : "Unable to delete this address.");
    } finally {
      setDeletingAddressId(null);
    }
  }

  async function showAddressBookPage() {
    setView("addresses");
    setAddressBookLoading(true);
    setAddressBookError("");
    setAddressPageMessage("");
    try {
      const response = await fetch("/api/addresses", { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Unable to load the address book.");
      setAddressBookEntries(Array.isArray(data.addresses) ? data.addresses : []);
    } catch (error) {
      setAddressBookError(error instanceof Error ? error.message : "Unable to load the address book.");
    } finally {
      setAddressBookLoading(false);
    }
  }

  async function updateNewAddress(field: keyof BookingParty, value: string) {
    setNewAddress((current) => ({ ...current, [field]: value }));
    if (field !== "zip" || !/^\d{5}$/.test(value)) return;
    try {
      const response = await fetch(`/api/locations/${value}`);
      const data = await response.json();
      if (!response.ok) return;
      setNewAddress((current) => ({ ...current, state: String(data.state || ""), city: String(data.cities?.[0] || "") }));
    } catch {
      // The user can still enter the city and state manually.
    }
  }

  async function addAddress(event: FormEvent) {
    event.preventDefault();
    if (!addressCategory) {
      setAddressBookError(tx("Choose at least one address category."));
      return;
    }
    setSavingAddress(true);
    setAddressBookError("");
    setAddressPageMessage("");
    try {
      const response = await fetch(editingAddressId ? `/api/addresses/${editingAddressId}` : "/api/addresses", { method: editingAddressId ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...newAddress, category: addressCategory }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Unable to save this address.");
      setAddressBookEntries((current) => editingAddressId ? current.map((entry) => entry.id === data.address.id ? data.address : entry) : [data.address, ...current.filter((entry) => entry.id !== data.address.id)]);
      setNewAddress({ ...blankBookingParty });
      setAddressCategory("");
      setEditingAddressId(null);
      setAddressPageMessage(editingAddressId ? "Address updated." : "Address saved.");
    } catch (error) {
      setAddressBookError(error instanceof Error ? error.message : "Unable to save this address.");
    } finally {
      setSavingAddress(false);
    }
  }

  function editAddress(entry: AddressBookEntry) {
    const { id, created_at: _createdAt, updated_at: _updatedAt, ...address } = entry;
    setEditingAddressId(id);
    setNewAddress({ ...address, save: "no" });
    setAddressCategory(entry.category ?? "");
    setAddressPageMessage("");
    setAddressBookError("");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function cancelAddressEdit() {
    setEditingAddressId(null);
    setNewAddress({ ...blankBookingParty });
    setAddressCategory("");
  }

  async function saveAddressesToBook() {
    const selected = (["sender", "receiver"] as const).filter((party) => bookingDetails[party].save === "new");
    if (!selected.length) return { saved: 0, error: "" };
    const results = await Promise.all(selected.map(async (party) => {
      const response = await fetch("/api/addresses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...bookingDetails[party], category: party, keepExisting: true }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || `Unable to save the ${party} address.`);
      return party;
    }));
    setBookingDetails((current) => ({
      ...current,
      ...Object.fromEntries(results.map((party) => [party, { ...current[party], save: "no" }])),
    }));
    return { saved: results.length, error: "" };
  }

  async function loadSavedQuotes(nextView: "quotes" | "orders") {
    setView(nextView);
    setSavedQuotesLoading(true);
    setSavedQuotesError("");
    try {
      const response = await fetch("/api/quotes", { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Unable to load saved quotes.");
      setSavedQuotes(Array.isArray(data.quotes) ? data.quotes : []);
      const depositResponse = await fetch("/api/deposit", { cache: "no-store" });
      if (depositResponse.ok) {
        const depositData = await depositResponse.json();
        setDeposit(Number(depositData.availableBalance));
      }
    } catch (error) {
      setSavedQuotesError(error instanceof Error ? error.message : "Unable to load saved quotes.");
    } finally {
      setSavedQuotesLoading(false);
    }
  }

  function showSavedQuotes() {
    return loadSavedQuotes("quotes");
  }

  function showOrders() {
    return loadSavedQuotes("orders");
  }

  async function showDeposit() {
    setView("deposit");
    setDepositOverviewVersion(version => version + 1);
    setDepositLoading(true);
    setDepositError("");
    try {
      const response = await fetch("/api/deposit", { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Unable to load deposit activity.");
      setDeposit(Number(data.availableBalance));
      setDepositTransactions(Array.isArray(data.transactions) ? data.transactions : []);
    } catch (error) {
      setDepositError(error instanceof Error ? error.message : "Unable to load deposit activity.");
    } finally {
      setDepositLoading(false);
    }
  }

  async function showSettings() {
    setView("settings");
    setSettingsLoading(true);
    setSettingsError("");
    setSettingsMessage("");
    try {
      const response = await fetch("/api/settings", { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Unable to load settings.");
      setSettings(data.settings);
    } catch (error) {
      setSettingsError(error instanceof Error ? error.message : "Unable to load settings.");
    } finally {
      setSettingsLoading(false);
    }
  }

  async function saveSettings(event: FormEvent) {
    event.preventDefault();
    setSettingsLoading(true);
    setSettingsError("");
    setSettingsMessage("");
    try {
      const response = await fetch("/api/settings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(settings) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Unable to save settings.");
      setSettings(data.settings);
      setPickupReadyTime(data.settings.default_ready_time);
      setPickupCloseTime(data.settings.default_close_time);
      setBookingDetails((current) => ({ ...current, sender: { ...current.sender, company: current.sender.company || data.settings.company_name, contact: current.sender.contact || data.settings.contact_name, email: current.sender.email || data.settings.email, phone: current.sender.phone || data.settings.phone } }));
      setSettingsMessage("Settings saved and applied to new bookings.");
    } catch (error) {
      setSettingsError(error instanceof Error ? error.message : "Unable to save settings.");
    } finally {
      setSettingsLoading(false);
    }
  }

  async function showCustomers() {
    setView("customers");
    setCustomersLoading(true);
    setCustomersError("");
    try {
      const response = await fetch("/api/customers", { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Unable to load customers.");
      setCustomers(Array.isArray(data.customers) ? data.customers : []);
    } catch (error) {
      setCustomersError(error instanceof Error ? error.message : "Unable to load customers.");
    } finally {
      setCustomersLoading(false);
    }
  }

  async function createCustomer(event: FormEvent) {
    event.preventDefault();
    setCustomersLoading(true);
    setCustomersError("");
    try {
      const response = await fetch("/api/customers", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(customerForm) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Unable to create the customer.");
      setCustomerForm({ name: "", code: "", markupPercent: "0", minimumMarkup: "0", canSelfBook: true, userName: "", email: "", password: "" });
      await showCustomers();
    } catch (error) {
      setCustomersError(error instanceof Error ? error.message : "Unable to create the customer.");
      setCustomersLoading(false);
    }
  }

  async function selectCustomer(customer: Customer) {
    setCustomersLoading(true);
    setCustomersError("");
    try {
      const response = await fetch("/api/customers/select", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ customerId: customer.id }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Unable to select the customer.");
      await checkSession();
      setSavedQuotes([]);
      setAddressBookEntries([]);
      setDepositTransactions([]);
      invalidateRates("Customer changed. Get rates again using this customer's pricing.");
      await showCustomers();
    } catch (error) {
      setCustomersError(error instanceof Error ? error.message : "Unable to select the customer.");
      setCustomersLoading(false);
    }
  }

  async function updateCustomer(customer: Customer) {
    setCustomersLoading(true);
    setCustomersError("");
    try {
      const response = await fetch(`/api/customers/${customer.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: customer.name, active: customer.active, canSelfBook: customer.can_self_book, markupPercent: customer.markup_percent, minimumMarkup: customer.minimum_markup }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Unable to update the customer.");
      await showCustomers();
      return true;
    } catch (error) {
      setCustomersError(error instanceof Error ? error.message : "Unable to update the customer.");
      setCustomersLoading(false);
      return false;
    }
  }

  async function createUser(event: FormEvent) {
    event.preventDefault();
    setCustomersLoading(true);
    setCustomersError("");
    try {
      const response = await fetch("/api/users", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(customerAdmin ? { ...userForm, customerId: authUser?.customerId, role: "customer" } : userForm) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Unable to create the user.");
      setUserForm({ customerId: "", fullName: "", email: "", password: "", role: "customer" });
      await showCustomers();
    } catch (error) {
      setCustomersError(error instanceof Error ? error.message : "Unable to create the user.");
      setCustomersLoading(false);
    }
  }

  async function updateUser(user: Customer["app_users"][number], requestedEmail?: string) {
    setCustomersLoading(true);
    setCustomersError("");
    try {
      const response = await fetch(`/api/users/${user.user_id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ fullName: user.full_name, ...(platformAdmin ? { role: user.role } : {}), active: user.active, requestedEmail }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Unable to update the user.");
      await showCustomers();
      return true;
    } catch (error) {
      setCustomersError(error instanceof Error ? error.message : "Unable to update the user.");
      setCustomersLoading(false);
      return false;
    }
  }

  async function deleteCustomer(customer: Customer) {
    if (!window.confirm(`Delete ${customer.name}? Only an empty customer workspace can be deleted.`)) return;
    setCustomersLoading(true);
    setCustomersError("");
    try {
      const response = await fetch(`/api/customers/${customer.id}`, { method: "DELETE" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Unable to delete the customer.");
      await showCustomers();
    } catch (error) {
      setCustomersError(error instanceof Error ? error.message : "Unable to delete the customer.");
      setCustomersLoading(false);
    }
  }

  async function deleteUser(user: Customer["app_users"][number]) {
    if (!window.confirm(`Delete login user ${user.full_name} (${user.email})? This immediately removes login access.`)) return;
    setCustomersLoading(true);
    setCustomersError("");
    try {
      const response = await fetch(`/api/users/${user.user_id}`, { method: "DELETE" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Unable to delete the login user.");
      await showCustomers();
    } catch (error) {
      setCustomersError(error instanceof Error ? error.message : "Unable to delete the login user.");
      setCustomersLoading(false);
    }
  }

  function copyQuoteForRequote(quote: SavedQuote) {
    clearDeliveryCheck();
    setOrigin(quote.origin_zip);
    setDestination(quote.destination_zip);
    setOriginAddress(`${quote.sender.address1}${quote.sender.address2 ? `, ${quote.sender.address2}` : ""}, ${quote.sender.city}, ${quote.sender.state} ${quote.sender.zip} · Copied order`);
    setDestinationAddress(`${quote.receiver.address1}${quote.receiver.address2 ? `, ${quote.receiver.address2}` : ""}, ${quote.receiver.city}, ${quote.receiver.state} ${quote.receiver.zip} · Copied order`);
    setBookingDetails({ sender: { ...quote.sender, save: "no" }, receiver: { ...quote.receiver, save: "no" }, reference: "", skipAddressVerification: false });
    setItems((quote.freight_items || []).map((item, index) => ({ ...initialItem, ...item, id: Date.now() + index, pallets: String(item.pallets), pieces: String(item.pieces ?? item.pallets), length: String(item.length), width: String(item.width), height: String(item.height), unitWeight: String(item.unitWeight) })));
    setSelectedServices(Array.isArray(quote.services) ? quote.services : []);
    setPickupReadyTime(quote.pickup_ready_time || settings.default_ready_time);
    setPickupCloseTime(quote.pickup_close_time || settings.default_close_time);
    setRates([]);
    setSelectedRate(null);
    setBookingOpen(false);
    setSelectedOrder(null);
    setQuoteMessage(`Details copied from ${quote.quote_number}. Get new rates before booking.`);
    setView("new");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function generateBol(quoteId: string, reconcile = false) {
    setQuoteActionId(quoteId);
    setSavedQuotesError("");
    setSavedQuotesNotice("");
    try {
      const response = await fetch(`/api/quotes/${quoteId}/bol${reconcile ? "?reconcile=true" : ""}`, { method: "POST" });
      const data = await response.json();
      if (!response.ok) { await showSavedQuotes(); throw new Error(data.error || "Unable to generate the BOL."); }
      if (view === "orders") await showOrders();
      else await showSavedQuotes();
      setSavedQuotesNotice(`BOL ${data.quote?.bol_number || ""} was generated and carrier pickup was scheduled.`.replace("BOL  was", "BOL was"));
    } catch (error) {
      setView("quotes");
      setSavedQuotesError(error instanceof Error ? error.message : "Unable to generate the BOL.");
    } finally {
      setQuoteActionId(null);
    }
  }

  function confirmAndGenerateBol(quote: SavedQuote) {
    setPendingBolQuote(quote);
  }

  async function voidShipment(quote: SavedQuote) {
    if (!window.confirm(`Void ${quote.quote_number}? If the carrier confirms cancellation, the shipment and pickup will be cancelled and $${Number(quote.price).toFixed(2)} will be returned to the deposit.`)) return;
    setQuoteActionId(quote.id);
    setSavedQuotesError("");
    setSavedQuotesNotice("");
    try {
      const response = await fetch(`/api/quotes/${quote.id}/void`, { method: "POST" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Unable to void this shipment.");
      if (view === "orders") await showOrders();
      else await showSavedQuotes();
      setSavedQuotesNotice(`${quote.quote_number} and its pickup were cancelled. $${Number(quote.price).toFixed(2)} was returned to the deposit.`);
    } catch (error) {
      setSavedQuotesError(error instanceof Error ? error.message : "Unable to void this shipment.");
    } finally {
      setQuoteActionId(null);
    }
  }

  async function saveBookingDetails(event: FormEvent) {
    event.preventDefault();
    if (selectedRate === null || !rates[selectedRate]) return;
    const submitter = (event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
    const generateAfterSaving = submitter?.value === "generate";
    if (generateAfterSaving && !window.confirm(`Generate the BOL and schedule carrier pickup? $${selectedPrice.toFixed(2)} will be deducted from the deposit.`)) return;
    setSavingBooking(true);
    setBookingMessage("");
    try {
      const response = await fetch("/api/quotes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          originZip: origin,
          destinationZip: destination,
          readyDate,
          rate: rates[selectedRate],
          items: items.map((item) => ({
            ...item,
            totalWeight: Math.ceil((Number(item.pallets) || 0) * (Number(item.unitWeight) || 0)),
            freightClass: calculateDensityClass(Number(item.length), Number(item.width), Number(item.height), Number(item.unitWeight)),
          })),
          services: selectedServices,
          sender: bookingDetails.sender,
          receiver: bookingDetails.receiver,
          reference: bookingDetails.reference,
          skipAddressVerification: bookingDetails.skipAddressVerification,
          pickupReadyTime,
          pickupCloseTime,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Unable to save this quote.");
      let addressMessage = "";
      try {
        const addressResult = await saveAddressesToBook();
        if (addressResult.saved) addressMessage = ` ${addressResult.saved} ${addressResult.saved === 1 ? "address was" : "addresses were"} saved to the address book.`;
      } catch (error) {
        addressMessage = ` Quote saved, but the address book was not updated: ${error instanceof Error ? error.message : "Unknown error."}`;
      }
      setBookingMessage(`Quote ${data.quote.quote_number} saved.${addressMessage}`);
      if (generateAfterSaving) {
        setView("quotes");
        await generateBol(data.quote.id);
      } else {
        await showSavedQuotes();
      }
    } catch (error) {
      setBookingMessage(error instanceof Error ? error.message : "Unable to save this quote.");
    } finally {
      setSavingBooking(false);
    }
  }

  async function getRates(event: FormEvent) {
    event.preventDefault();
    if (loading || checkingDelivery) return;
    setLoading(true);
    if (smartText.trim()) {
      try {
        const history = await fetch("/api/quote-inputs", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: smartText, source: quickQuote ? "mobile" : "desktop" }),
        });
        if (!history.ok) {
          const result = await history.json();
          throw new Error(result.error || "Unable to save SMART QUOTE history.");
        }
      } catch (error) {
        setLoading(false);
        setQuoteMessage(error instanceof Error ? error.message : "Unable to save SMART QUOTE history.");
        return;
      }
    }
    const parsed = quickQuote ? parseSmartQuote(smartText) : null;
    const needsDimensionUnit = (parsed ?? smartResult)?.missing.includes(missingDimensionUnit);
    const incompleteDimensions = (parsed?.items ?? items).some((item) => !item.length || !item.width || !item.height);
    if (needsDimensionUnit && (parsed || incompleteDimensions)) {
      setLoading(false);
      setRates([]);
      setQuoteMessage(language === "zh" ? "请注明尺寸单位，例如 3.25 × 1.2 × 1.3 米。" : "Specify the dimension unit, for example 3.25 × 1.2 × 1.3 m.");
      return;
    }
    if (parsed?.missing.length) {
      setLoading(false);
      setRates([]);
      setQuoteMessage(language === "zh" ? "请填写发货地址、收货地址，以及每件货物的尺寸和重量。" : "Enter pickup and delivery addresses, plus dimensions and weight for every freight line.");
      return;
    }
    setLoading(true);
    setRateProgress({});
    setSelectedRate(null);
    setBookingOpen(false);
    setQuoteMessage("");
    try {
      let services = parsed?.services ?? selectedServices;
      if (parsed && !parsed.hasDeclaredDeliveryType) {
        const sameAddress = deliveryCheck?.address === parsed.destinationAddress && deliveryCheck.zip === parsed.destinationZip;
        const classification = sameAddress && deliveryCheck.classification !== "unavailable"
          ? deliveryCheck.classification : await classifyDeliveryAddress(parsed.destinationAddress, parsed.destinationZip);
        setDeliveryCheck({ address: parsed.destinationAddress, zip: parsed.destinationZip, classification });
        const residential = quickResidential ?? (classification === "residential" || services.includes("Residential delivery"));
        services = services.filter((service) => service !== "Residential delivery");
        if (residential) services.push("Residential delivery");
      }
      const response = await fetch("/api/quotes/rates", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/x-ndjson" },
        body: JSON.stringify({
          originZip: parsed?.originZip ?? origin,
          destinationZip: parsed?.destinationZip ?? destination,
          originAddress: parsed?.originAddress ?? originAddress,
          destinationAddress: parsed?.destinationAddress ?? destinationAddress,
          readyDate,
          services,
          items: (parsed?.items ?? items).map((item) => ({
            ...item,
            freightClass: calculateDensityClass(Number(item.length), Number(item.width), Number(item.height), Number(item.unitWeight)),
          })),
        }),
      });
      let data;
      if (response.headers.get("content-type")?.includes("application/x-ndjson") && response.body) {
        const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
        let buffer = "";
        try {
          while (true) {
            const chunk = await reader.read();
            if (chunk.done) break;
            buffer += chunk.value;
            const lines = buffer.split("\n");
            buffer = lines.pop() ?? "";
            for (const line of lines) {
              if (!line) continue;
              const event = JSON.parse(line);
              if (event.type === "provider" && Object.hasOwn(rateProviderLabels, event.id)) {
                setRateProgress((current) => ({ ...current, [event.id]: { status: event.status, elapsedMs: event.elapsedMs } }));
              } else if (event.type === "result") {
                if (!event.ok) throw new Error(event.data.error || "Unable to get rates.");
                data = event.data;
              }
            }
          }
        } finally {
          await reader.cancel();
          reader.releaseLock();
        }
        if (!data) throw new Error("The quote request ended before results arrived.");
      } else {
        data = await response.json();
        if (!response.ok) throw new Error(data.error || "Unable to get rates.");
      }

      const normalized: Rate[] = data.rates.map((rate: { provider: "wwex" | "priority1" | "tql" | "mothership"; carrier: string; service: string; transitDays: number | null; price: number; providerRef: Record<string, string | number>; quoteToken: string }) => ({
        quoteToken: rate.quoteToken,
        carrier: rate.carrier,
        service: `${rate.provider === "wwex" ? "WWEX" : rate.provider === "tql" ? "TQL" : rate.provider === "mothership" ? "Mothership" : "Priority1"} · ${rate.service}`,
        transit: rate.transitDays ? `${rate.transitDays} ${rate.transitDays === 1 ? "day" : "days"}` : "Not provided",
        price: rate.price,
        provider: rate.provider,
        providerRef: rate.providerRef,
      }));
      const lowestPrice = Math.min(...normalized.map((rate) => rate.price));
      const transitValues = normalized.map((rate) => Number.parseInt(rate.transit, 10)).filter(Number.isFinite);
      const fastestTransit = transitValues.length ? Math.min(...transitValues) : null;
      const withBadges = normalized.map((rate) => ({
        ...rate,
        badge: rate.price === lowestPrice ? "Lowest price" : fastestTransit !== null && Number.parseInt(rate.transit, 10) === fastestTransit ? "Fastest" : undefined,
      }));
      setRates(withBadges);
      const failedProviders = Object.keys(data.providerErrors || {});
      if (failedProviders.length) setQuoteMessage(`${failedProviders.join(" and ").toUpperCase()} did not return rates. Other available rates are shown.`);
      setLoading(false);
      window.setTimeout(() => document.getElementById("rates")?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
    } catch (error) {
      setRates([]);
      setQuoteMessage(error instanceof Error ? error.message : "Unable to get rates.");
      setLoading(false);
    }
  }

  async function smartFill() {
    await fillShipmentDraft(parseSmartQuote(smartText));
  }

  async function fillShipmentDraft(result: SmartQuoteResult) {
    const previousCheck = deliveryCheck;
    clearDeliveryCheck();
    setSmartResult(result);

    if (result.originZip) setOrigin(result.originZip);
    if (result.destinationZip) setDestination(result.destinationZip);
    if (result.originAddress) setOriginAddress(result.originAddress);
    if (result.destinationAddress) setDestinationAddress(result.destinationAddress);
    if (result.items.length > 0) {
      setItems(result.items.map((item, index) => ({ ...item, id: Date.now() + index })));
    }
    setSelectedServices(result.services);
    invalidateRates();
    if (result.hasDeclaredDeliveryType || !result.destinationAddress || !result.destinationZip) return;

    const requestId = deliveryCheckRequest.current;
    setCheckingDelivery(true);
    const sameAddress = previousCheck?.address === result.destinationAddress && previousCheck.zip === result.destinationZip;
    const classification = sameAddress && previousCheck.classification !== "unavailable"
      ? previousCheck.classification : await classifyDeliveryAddress(result.destinationAddress, result.destinationZip);
    if (requestId !== deliveryCheckRequest.current) return;
    setCheckingDelivery(false);
    setDeliveryCheck({ address: result.destinationAddress, zip: result.destinationZip, classification });
    if (classification === "residential" && !result.services.includes("Residential delivery")) {
      autoResidential.current = true;
      setSelectedServices((current) => current.includes("Residential delivery") ? current : [...current, "Residential delivery"]);
    }
  }

  if (authState !== "ready") {
    return (
      <main className="auth-shell" lang={language === "zh" ? "zh-CN" : "en"}>
        <button type="button" className="language-toggle auth-language" onClick={toggleLanguage}>{language === "en" ? "中文" : "English"}</button>
        <section className="auth-card">
          <Image className="auth-logo" src="/qianvushi-logo.jpg" alt="Shenzhen Qianyushi Supply Chain Service Co., Ltd. logo" width={64} height={64} priority />
          <p className="eyebrow">QIANYUSHI LTL</p>
          <h1>{authState === "signed-out" ? (language === "zh" ? "您已退出登录" : "You’ve been signed out") : tx(authState === "checking" ? "Opening your workspace…" : authState === "setup" ? "Create administrator" : "Sign in")}</h1>
          {authState === "signed-out" ? (
            <div className="auth-form">
              <p className="auth-subtitle" role="status">{language === "zh" ? "您的会话已结束。账号在其他设备登录或会话过期时，系统会退出当前页面。" : "Your session ended. This can happen when you sign in on another device or your session expires."}</p>
              <button type="button" onClick={() => window.location.reload()}>{language === "zh" ? "重新登录" : "Sign in again"}</button>
            </div>
          ) : authState === "checking" ? <p className="auth-subtitle">{tx("Checking the secure workspace.")}</p> : <form onSubmit={submitAuthentication} className="auth-form">{authState === "setup" && <label>{tx("Administrator name")}<input required value={authForm.name} onChange={(event) => setAuthForm((current) => ({ ...current, name: event.target.value }))} autoComplete="name" /></label>}<label>{tx("Email")}<input required type="email" value={authForm.email} onChange={(event) => setAuthForm((current) => ({ ...current, email: event.target.value }))} autoComplete="email" /></label><label>{tx("Password")}<input required minLength={8} type="password" value={authForm.password} onChange={(event) => setAuthForm((current) => ({ ...current, password: event.target.value }))} autoComplete={authState === "setup" ? "new-password" : "current-password"} /></label>{authError && <p className="auth-error" role="alert">{authError}</p>}<button type="submit" disabled={authLoading}>{tx(authLoading ? "Please wait…" : authState === "setup" ? "Create administrator" : "Sign in")}</button>{authState === "setup" && <small>{language === "zh" ? "这是第一个账户，将拥有完整管理员权限。" : "This is the first account and will have full administrator access."}</small>}</form>}
        </section>
      </main>
    );
  }

  const platformAdmin = authUser?.role === "admin";
  const customerAdmin = authUser?.role === "customer_admin";
  const customerAdminLabel = language === "zh" ? "客户管理员" : "Customer administrator";
  const createLoginUserForm = (<form onSubmit={createUser} className="customer-form">{platformAdmin && <label>{tx("Customer")}<select required value={userForm.customerId} onChange={(event) => setUserForm((current) => ({ ...current, customerId: event.target.value }))}><option value="">{tx("Select customer")}</option>{customers.filter((customer) => customer.active).map((customer) => <option key={customer.id} value={customer.id}>{customer.name}</option>)}</select></label>}<label>{tx("Name")}<input required value={userForm.fullName} onChange={(event) => setUserForm((current) => ({ ...current, fullName: event.target.value }))} /></label><label>{tx("Email")}<input required type="email" value={userForm.email} onChange={(event) => setUserForm((current) => ({ ...current, email: event.target.value }))} /></label><label>{tx("Temporary password")}<input required type="password" minLength={8} value={userForm.password} onChange={(event) => setUserForm((current) => ({ ...current, password: event.target.value }))} /></label>{platformAdmin && <label>{tx("Role")}<select value={userForm.role} onChange={(event) => setUserForm((current) => ({ ...current, role: event.target.value }))}><option value="customer">{tx("Customer")}</option><option value="sales">{tx("Sales")}</option><option value="operations">{tx("Operations")}</option><option value="customer_admin">{customerAdminLabel}</option><option value="admin">{tx("Administrator")}</option></select></label>}<button type="submit" disabled={customersLoading}>{customersLoading ? tx("Please wait…") : tx("Create login user")}</button></form>);
  const userRoleLabels: Record<string, string> = {
    admin: tx("Administrator"),
    customer_admin: customerAdminLabel,
    operations: tx("Operations"),
    sales: tx("Sales"),
    customer: tx("Customer"),
  };

  const deliveryCheckNotice = checkingDelivery
    ? (language === "zh" ? "正在核对收货地址…" : "Checking delivery address…")
    : deliveryCheck && (language === "zh"
      ? { residential: "Google Maps 识别为住宅。请确认卸货条件及是否需要预约。", business: "Google Maps 识别为商业地址。请确认卸货条件及是否需要预约。", unknown: "无法确认地址类型，请核对是否为住宅。", unavailable: "地址验证暂不可用，请自行确认是否为住宅。" }[deliveryCheck.classification]
      : { residential: "Google Maps identified a residential address. Confirm unloading equipment and appointment needs.", business: "Google Maps identified a business address. Confirm unloading equipment and appointment needs.", unknown: "Address type was unclear. Confirm whether this is a residence.", unavailable: "Address verification is unavailable. Confirm whether this is a residence." }[deliveryCheck.classification]);

  const deliveryCheckTitle = language === "zh" ? "收货地址核对" : "Delivery address check";
  const deliveryCheckClass = deliveryCheck && deliveryCheck.classification !== "business" ? "delivery-check-notice needs-review" : "delivery-check-notice";

  const quoteProgress = (loading || Object.keys(rateProgress).length > 0) ? (
    <section className="quote-progress" aria-label={language === "zh" ? "询价进度" : "Quote progress"}>
      <progress aria-label={language === "zh" ? "已处理的平台" : "Quote sources processed"} max={4} value={Object.values(rateProgress).filter((entry) => entry.status !== "pending").length} />
      <div className="quote-progress-items" aria-live="polite">
        {(Object.keys(rateProviderLabels) as RateProvider[]).map((id) => {
          const entry = rateProgress[id];
          const status = entry?.status ?? (loading ? "pending" : "failed");
          const label = language === "zh"
            ? { pending: "等待中", done: "完成", empty: "无报价", failed: "失败", disabled: "未启用" }[status]
            : { pending: "Waiting", done: "Done", empty: "No rates", failed: "Failed", disabled: "Disabled" }[status];
          const symbol = { pending: "…", done: "✓", empty: "∅", failed: "!", disabled: "–" }[status];
          const elapsed = entry?.elapsedMs === undefined ? "" : `${(entry.elapsedMs / 1000).toFixed(1)}s`;
          return <span key={id} title={label} aria-label={`${id[0].toUpperCase()} · ${label}${elapsed ? ` · ${elapsed}` : ""}`}>{id[0].toUpperCase()} <span aria-hidden="true">{symbol}{elapsed && ` ${elapsed}`}</span></span>;
        })}
      </div>
    </section>
  ) : null;

  if (quickQuote) {
    return (
      <main className="quick-quote" lang={language === "zh" ? "zh-CN" : "en"}>
        <header className="brand quick-quote-brand">
          <Image className="brand-logo" src="/qianvushi-logo.jpg" alt="" width={52} height={52} priority />
          <div><strong>SHENZHEN QIANYUSHI</strong><span>SUPPLY CHAIN SERVICE CO., LTD.</span></div>
        </header>
        <form onSubmit={getRates} className="smart-quote-panel">
          <h1><label htmlFor="quick-quote-text">SMART QUOTE</label></h1>
          <div className="smart-input-row">
            <textarea id="quick-quote-text" required disabled={loading} rows={5} value={smartText} placeholder={smartQuoteExample} onChange={(event) => {
              if (deliveryCheck) {
                const updated = parseSmartQuote(event.target.value);
                if (updated.hasDeclaredDeliveryType || updated.destinationAddress !== deliveryCheck.address || updated.destinationZip !== deliveryCheck.zip) {
                  setDeliveryCheck(null);
                  setQuickResidential(null);
                }
              }
              setSmartText(event.target.value);
              setRateProgress({});
              setRates([]);
              setQuoteMessage("");
            }} />
            <button type="submit" disabled={loading || !readyDate}>{tx(loading ? "Comparing carriers…" : "Get rates")}</button>
          </div>
          {deliveryCheckNotice && <div className={deliveryCheckClass}>
            <span role="status"><strong>{deliveryCheckTitle}</strong> {deliveryCheckNotice}</span>
            <label><input type="checkbox" disabled={loading}
              checked={quickResidential ?? (deliveryCheck?.classification === "residential" || parseSmartQuote(smartText).services.includes("Residential delivery"))}
              onChange={(event) => { setQuickResidential(event.target.checked); setRates([]); setQuoteMessage(""); }}
            /> {tx("Residential delivery")}</label>
          </div>}
          {quoteProgress}
        </form>
        {quoteMessage && <p className="quote-message" role="status">{quoteMessage}</p>}
        {visibleRates.length > 0 && (
          <section className="rates-section" id="rates" aria-label={tx("QUOTE RESULTS")}>
            <div className="rate-list">
              {visibleRates.map((rate, index) => (
                <article className="rate-card" key={`${rate.provider}-${rate.carrier}-${index}`}>
                  <span className="rate-provider">{rate.provider?.[0].toUpperCase()}</span>
                  <span className="carrier"><strong>{rate.carrier}</strong><small>{language === "zh" ? tx(rate.transit).replace(/^(\d+) days?$/, "$1 天") : rate.transit}</small></span>
                  <span className="price"><strong>${rate.price.toFixed(2)}</strong></span>
                </article>
              ))}
            </div>
          </section>
        )}
      </main>
    );
  }

  return (
    <div className="app-shell" lang={language === "zh" ? "zh-CN" : "en"}>
      <aside className="sidebar">
        <div className="brand">
          <Image className="brand-logo" src="/qianvushi-logo.jpg" alt="Shenzhen Qianyushi Supply Chain Service Co., Ltd. logo" width={42} height={42} priority />
          <div><strong>SHENZHEN QIANYUSHI</strong><span>SUPPLY CHAIN SERVICE CO., LTD.</span></div>
        </div>

        <nav>
          <p className="nav-label">{tx("WORKSPACE")}</p>
          <button type="button" className={`nav-item ${view === "new" ? "active" : ""}`} onClick={() => setView("new")}><Icon>＋</Icon>{tx("New quote")}</button>
          <button type="button" className={`nav-item ${view === "quotes" ? "active" : ""}`} onClick={() => void showSavedQuotes()}><Icon>⌁</Icon>{tx("Quotes")}</button>
          <button type="button" className={`nav-item ${view === "orders" ? "active" : ""}`} onClick={() => void showOrders()}><Icon>▣</Icon>{tx("Orders")}</button>
          <button type="button" className={`nav-item ${view === "reader" ? "active" : ""}`} onClick={() => setView("reader")}><Icon>▤</Icon>{language === "zh" ? "资料识别" : "Shipment reader"}</button>
          <button type="button" className={`nav-item ${view === "addresses" ? "active" : ""}`} onClick={() => void showAddressBookPage()}><Icon>⌂</Icon>{tx("Address book")}</button>
          {!authUser?.legacy && (platformAdmin || customerAdmin) && <button type="button" className={`nav-item ${view === "customers" || view === "quote-inputs" ? "active" : ""}`} onClick={() => void showCustomers()}><Icon>◎</Icon>{language === "zh" ? "公司账户" : "Company Account"}</button>}
          <p className="nav-label second">{tx("ACCOUNT")}</p>
          {authUser && !authUser.legacy && <button type="button" className={`nav-item ${view === "account" ? "active" : ""}`} onClick={() => {
            if (view !== "account") setAccountBack(view);
            setView("account");
          }}><Icon>◎</Icon>{language === "zh" ? "我的账户" : "My Account"}</button>}
          <button type="button" className={`nav-item ${view === "deposit" ? "active" : ""}`} onClick={() => void showDeposit()}><Icon>◇</Icon>{tx("Deposit")}</button>
          {platformAdmin && <button type="button" className={`nav-item ${view === "settings" ? "active" : ""}`} onClick={() => void showSettings()}><Icon>⚙</Icon>{tx("Settings")}</button>}
        </nav>

        <div className="sidebar-footer">
          <div className="avatar">{authUser?.name.split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase() || "US"}</div>
          <div><strong>{authUser?.name}</strong><span>{authUser?.legacy ? "Administrator · setup pending" : `${customerAdmin ? customerAdminLabel : authUser?.role} · ${authUser?.customerName}`}</span></div>
          {authUser?.legacy ? <span /> : <button type="button" aria-label={tx("Sign out")} title={tx("Sign out")} onClick={() => void logout()}>↪</button>}
        </div>
      </aside>

      <main>
        <header className="topbar">
          <div className="crumb"><span>{tx(view === "new" || view === "quotes" ? "Quotes" : view === "addresses" ? "Address book" : view === "reader" ? (language === "zh" ? "资料识别" : "Shipment reader") : view.charAt(0).toUpperCase() + view.slice(1))}</span>{view === "new" && <><b>/</b> {tx("New quote")}</>}</div>
          <div className="top-actions"><button type="button" className="language-toggle" onClick={toggleLanguage}>{language === "en" ? "中文" : "English"}</button><button type="button" className="help" aria-label={language === "zh" ? "打开帮助" : "Open help"} title={language === "zh" ? "帮助" : "Help"} onClick={() => setHelpOpen(true)}>?</button></div>
        </header>

        {view === "reader" && <div className="content"><ShipmentReaderPanel language={language} onUse={(result, text) => {
          setSmartText(text);
          void fillShipmentDraft(result); setView("new");
          window.scrollTo({ top: 0, behavior: "smooth" });
        }} /></div>}
        <div className="content" id="quote" hidden={view !== "new"}>
          <section className="page-heading">
            <div><p className="eyebrow">{tx("CREATE SHIPMENT")}</p><h1>{tx("Get an LTL quote")}</h1></div>
            <div className="deposit-card" id="deposit">
              <div className="deposit-icon">$</div>
              <div><span>{tx("Available deposit")}</span><strong>${deposit.toLocaleString(language === "zh" ? "zh-CN" : "en-US", { minimumFractionDigits: 2 })}</strong></div>
              <button type="button" onClick={() => void showDeposit()}>{tx("View activity →")}</button>
            </div>
          </section>

          <section className="smart-quote-panel">
            <div className="smart-quote-copy">
              <div className="sparkle">✦</div>
              <div><p className="eyebrow">{tx("SMART QUOTE")}</p><h2>{tx("Paste shipment details to autofill")}</h2><details className="smart-format-help"><summary>{language === "zh" ? "填写格式" : "Format guide"}</summary><p>{tx("Line 1: sender. Line 2: receiver. Line 3 and after: one freight item per line. Commercial, residential, liftgate, and appointment keywords are recognized automatically.")}</p></details></div>
            </div>
            <div className="smart-input-row">
              <textarea
                aria-label="Smart quote shipment details"
                value={smartText}
                onChange={(event) => setSmartText(event.target.value)}
                placeholder={smartQuoteExample}
              />
              <button type="button" onClick={() => void smartFill()} disabled={!smartText.trim() || loading || checkingDelivery}><span>✦</span>{tx("Autofill")}</button>
            </div>
            {smartResult && (
              <div className={`smart-result ${smartResult.missing.length ? "needs-review" : "complete"}`}>
                <strong>{smartResult.missing.length ? "Recognized details were filled. Please review the missing fields." : "Autofill complete. Please review the details below."}</strong>
                {smartResult.conversions.length > 0 && <span>Conversions: {smartResult.conversions.join("; ")}</span>}
                {smartResult.services.length > 0 && <span>Detected services: {smartResult.services.join(", ")}</span>}
                {smartResult.missing.includes(missingDimensionUnit) && <span>{language === "zh" ? "请注明尺寸单位（米、厘米或英寸），再点自动填充。" : "Add a dimension unit (m, cm, or in), then select Autofill again."}</span>}
                {smartResult.missing.some((field) => field !== missingDimensionUnit) && <span>Still required: {smartResult.missing.filter((field) => field !== missingDimensionUnit).join(", ")}</span>}
              </div>
            )}
            {deliveryCheckNotice && <div className={deliveryCheckClass} role="status"><strong>{deliveryCheckTitle}</strong><span>{deliveryCheckNotice}</span></div>}
          </section>

          <form onSubmit={getRates}>
            <section className="panel">
              <div className="section-title"><span>1</span><div><h2>{tx("Route")}</h2><p>{tx("Where is the freight moving?")}</p></div></div>
              <div className="route-grid route-grid-single-row">
                <div className="field-block">
                  <label>{tx("SHIP FROM")}</label>
                  <div className="location-field"><span className="dot origin-dot" /><div><input value={origin} onChange={(e) => { setOrigin(e.target.value); invalidateRates(); }} aria-label="Origin ZIP" /><small>{originAddress}</small></div><button type="button" title={tx("Address book")} onClick={() => void openAddressBook("route-origin")}>{tx("Address book")}</button></div>
                </div>
                <div className="route-line"><span>→</span></div>
                <div className="field-block">
                  <label>{tx("SHIP TO")}</label>
                  <div className="location-field"><span className="dot destination-dot" /><div><input value={destination} onChange={(e) => { clearDeliveryCheck(); setDestination(e.target.value); invalidateRates(); }} aria-label="Destination ZIP" /><small>{destinationAddress}</small></div><button type="button" title={tx("Address book")} onClick={() => void openAddressBook("route-destination")}>{tx("Address book")}</button></div>
                </div>
                <div className="field-block ready-field">
                  <label htmlFor="quote-ready-date">{tx("READY DATE (PT)")}</label>
                  <input id="quote-ready-date" className="ready-date-input" type="date" value={readyDate} onChange={(event) => { setReadyDate(event.target.value); invalidateRates(); }} />
                </div>
              </div>
            </section>

            <section className="panel">
              <div className="section-title"><span>2</span><div><h2>{tx("Freight details")}</h2><p>{tx("All dimensions use inches and all weights use pounds.")}</p></div><div className="fixed-unit">INCH / LB</div></div>
              <div className="freight-list">
                {items.map((item, index) => {
                  const totalWeight = Math.ceil((Number(item.pallets) || 0) * (Number(item.unitWeight) || 0));
                  const freightClass = calculateDensityClass(Number(item.length), Number(item.width), Number(item.height), Number(item.unitWeight));
                  return (
                    <div className="freight-item" key={item.id}>
                      <div className="freight-line-scroll">
                      <div className="freight-grid-v3">
                        <div className="line-index">
                          <div><span>{tx("LINE")}</span><strong>{index + 1}</strong></div>
                          {items.length > 1 ? <button className="line-remove" type="button" onClick={() => removeItem(item.id)}>{tx("Remove")}</button> : <span className="line-remove-placeholder" />}
                        </div>
                        <div className="input-group"><label>{tx("Packaging")}</label><select value={item.packaging} onChange={(e) => updateItem(item.id, "packaging", e.target.value)}><option value="">{tx("Select")}</option><option value="Carton">{tx("Carton")}</option><option value="Crate">{tx("Crate")}</option><option value="Bale">{tx("Bale")}</option><option value="Roll">{tx("Roll")}</option><option value="Pallet">{tx("Pallet")}</option><option value="Loose">{tx("Loose")}</option></select></div>
                        <div className="input-group"><label>{tx("Stackable")}</label><select value={item.stackable ? "yes" : "no"} onChange={(e) => updateItem(item.id, "stackable", e.target.value === "yes")}><option value="yes">{tx("Yes")}</option><option value="no">{tx("No")}</option></select></div>
                        <div className="input-group"><label>{tx("Pallets")}</label><input inputMode="numeric" value={item.pallets} onChange={(e) => updateItem(item.id, "pallets", e.target.value)} /></div>
                        <div className="input-group"><label>{language === "zh" ? "件数" : "Pieces"}</label><input type="number" min="1" step="1" inputMode="numeric" value={item.pieces} onChange={(e) => updateItem(item.id, "pieces", e.target.value)} /></div>
                        <div className="input-group"><label>{tx("Length")}</label><div className="field-with-unit"><input inputMode="decimal" value={item.length} onChange={(e) => updateItem(item.id, "length", e.target.value)} /><span>in</span></div></div>
                        <div className="input-group"><label>{tx("Width")}</label><div className="field-with-unit"><input inputMode="decimal" value={item.width} onChange={(e) => updateItem(item.id, "width", e.target.value)} /><span>in</span></div></div>
                        <div className="input-group"><label>{tx("Height")}</label><div className="field-with-unit"><input inputMode="decimal" value={item.height} onChange={(e) => updateItem(item.id, "height", e.target.value)} /><span>in</span></div></div>
                        <div className="input-group"><label>{tx("Unit weight")}</label><div className="field-with-unit"><input inputMode="decimal" value={item.unitWeight} onChange={(e) => updateItem(item.id, "unitWeight", e.target.value)} /><span>lb</span></div></div>
                        <div className="input-group readonly-field"><label>{tx("Total weight")}</label><div className="field-with-unit"><input value={totalWeight || ""} readOnly aria-readonly="true" /><span>lb</span></div></div>
                        <div className="input-group readonly-field"><label>Class</label><input value={freightClass} readOnly aria-readonly="true" title="Density-based NMFC estimate" /></div>
                        <div className="input-group"><label htmlFor={`nmfc-${item.id}`}>NMFC #</label><input id={`nmfc-${item.id}`} value={item.nmfc || ""} maxLength={9} pattern="[0-9]+(-[0-9]+)?" title={language === "zh" ? "选填：数字及子项，例如 123456-01" : "Optional: item and subitem, e.g. 123456-01"} onChange={(e) => updateItem(item.id, "nmfc", e.target.value)} placeholder="Optional" /></div>
                        <div className="input-group"><label>{tx("Hazmat")}</label><select value={item.hazmat ? "yes" : "no"} onChange={(e) => updateItem(item.id, "hazmat", e.target.value === "yes")}><option value="no">{tx("No")}</option><option value="yes">{tx("Yes")}</option></select></div>
                        <div className="input-group"><label>{tx("Commodity")}</label><input value={item.commodity} onChange={(e) => updateItem(item.id, "commodity", e.target.value)} placeholder="e.g. Furniture" /></div>
                        <div className="input-group"><label>{tx("Declared value")}</label><div className="money-field"><span>$</span><input inputMode="decimal" value={item.declaredValue} onChange={(e) => updateItem(item.id, "declaredValue", e.target.value)} placeholder="0.00" /></div></div>
                      </div>
                      </div>
                    </div>
                  );
                })}
              </div>
              <p className="class-note">{language === "zh" ? "Class 根据当前 NMFC 13 档密度标准估算；特殊装卸、积载或责任要求可能以具体 NMFC Item 为准。" : "Class is estimated using the current NMFC 13-tier density scale. The NMFC item may override it for special handling, stowability, or liability concerns."}</p>
              <button className="add-item" type="button" onClick={addItem}>＋ {tx("Add another handling unit")}</button>
            </section>

            <section className="panel services-panel">
              <div className="section-title services-title"><span>3</span><div><h2>{tx("Additional services")}</h2></div></div>
              <div className="service-grid">
                {services.map((service) => <label className={`service-option ${selectedServices.includes(service) ? "selected" : ""}`} key={service}><input type="checkbox" checked={selectedServices.includes(service)} onChange={() => toggleService(service)} /><span>{tx(service)}</span></label>)}
              </div>
            </section>

            <div className="form-footer">
              <div><span className="shield">✓</span><p><strong>{tx("Your rates are private")}</strong><small>{tx("Customers only see the final selling price.")}</small></p></div>
              <div className="quote-rate-actions">
                {quoteProgress}
                <button className="primary-button" disabled={loading || checkingDelivery} aria-busy={loading || checkingDelivery}>{tx("Get rates")}<span>→</span></button>
              </div>
            </div>
            {quoteMessage && <p className="quote-message" role="status">{quoteMessage}</p>}
          </form>

          {rates.length > 0 && (
            <section className="rates-section" id="rates">
              <div className="rates-heading"><div><p className="eyebrow">{tx("QUOTE RESULTS")}</p><h2>{tx("Choose a rate")}</h2><p>{origin} → {destination}</p></div><span>P {priority1Count} · T {tqlCount} · W {wwexCount} · M {mothershipCount}</span></div>
              <div className="rate-list">
                {visibleRates.map((rate, index) => (
                  <button type="button" className={`rate-card ${selectedRate === index ? "selected" : ""}`} key={`${rate.provider}-${rate.carrier}-${rate.price}`} onClick={() => { setSelectedRate(index); setBookingOpen(false); }} onDoubleClick={() => { setSelectedRate(index); if (rate.provider !== "mothership") openBooking(); }}>
                    <span className="rate-provider" aria-hidden="true">{rate.provider?.[0].toUpperCase()}</span><span className="radio"><i /></span><span className="carrier"><strong>{rate.carrier}</strong></span><span className="transit"><small>{tx("Transit days")}</small><strong>{language === "zh" ? tx(rate.transit).replace(/^(\d+) days?$/, "$1 天") : rate.transit}</strong></span>{rate.badge && <span className="rate-badge">{tx(rate.badge)}</span>}<span className="price"><strong>${rate.price.toFixed(2)}</strong><small>{tx("Customer price")}</small></span>
                  </button>
                ))}
              </div>
              {mothershipSelected && <p className="quotes-empty">{language === "zh" ? "Mothership 报价仅供比较，暂未开放下单。" : "Mothership rates are available for comparison only."}</p>}
              {selectedRate !== null && !mothershipSelected && <div className="selection-bar"><div><span>{tx("Deposit after BOL")}</span><strong>${balanceAfter.toLocaleString(language === "zh" ? "zh-CN" : "en-US", { minimumFractionDigits: 2 })}</strong></div><p>{language === "zh" ? `生成 BOL 时将扣除 $${selectedPrice.toFixed(2)}。` : `$${selectedPrice.toFixed(2)} will be deducted when the BOL is generated.`}</p><button type="button" onClick={openBooking}>{tx("Continue to booking →")}</button></div>}
            </section>
          )}

          {bookingOpen && selectedRate !== null && rates[selectedRate] && (
            <section className="panel booking-panel" id="booking">
              <div className="booking-heading">
                <div><p className="eyebrow">{tx("BOOKING DETAILS")}</p><h2>{tx("Complete shipment contacts")}</h2><p>{language === "zh" ? "已选择" : "Selected"}: {rates[selectedRate].carrier} · ${rates[selectedRate].price.toFixed(2)}</p></div>
                <button type="button" onClick={() => setBookingOpen(false)} aria-label="Close booking details">×</button>
              </div>
              <form onSubmit={saveBookingDetails}>
                <div className="booking-toolbar">
                  <label>{language === "zh" ? "发货日期（美国太平洋时间）" : "Ship date (PT)"}<input type="date" value={readyDate} onChange={(event) => { setReadyDate(event.target.value); invalidateRates(); }} required /></label>
                  <label>{tx("Ready time")}<input type="time" value={pickupReadyTime} onChange={(event) => setPickupReadyTime(event.target.value)} required /></label>
                  <label>{tx("Close time")}<input type="time" value={pickupCloseTime} min={pickupReadyTime} onChange={(event) => setPickupCloseTime(event.target.value)} required /></label>
                  <label className="booking-toggle"><span>{tx("Skip address verification")}</span><input type="checkbox" checked={bookingDetails.skipAddressVerification} onChange={(event) => setBookingDetails((current) => ({ ...current, skipAddressVerification: event.target.checked }))} /></label>
                </div>
                <div className="booking-columns">
                  {(["sender", "receiver"] as const).map((party) => {
                    const details = bookingDetails[party];
                    return (
                      <fieldset key={party}>
                        <legend><span className="booking-legend-title">{tx(party === "sender" ? "Shipper" : "Consignee")}</span><span className="booking-legend-actions"><button type="button" className="legend-address-book" onClick={() => void openAddressBook(party)}>⌂ {tx("Address book")}</button><button type="button" onClick={() => clearBookingParty(party)}>{tx("Clear all")}</button></span></legend>
                        <label>{tx("Company or name")}<input required value={details.company} onChange={(event) => updateBookingParty(party, "company", event.target.value)} /></label>
                        <label>{tx("Country")}<input value={details.country} readOnly aria-readonly="true" /></label>
                        <label>{tx("Address 1")}<input required value={details.address1} onChange={(event) => updateBookingParty(party, "address1", event.target.value)} /></label>
                        <label>{tx("Address 2")} <small>{tx("Optional")}</small><input value={details.address2} onChange={(event) => updateBookingParty(party, "address2", event.target.value)} /></label>
                        <div className="booking-location-row">
                          <label>{tx("Postal code")}<input required inputMode="numeric" maxLength={5} value={details.zip} onChange={(event) => updateBookingParty(party, "zip", event.target.value.replace(/\D/g, "").slice(0, 5))} />{zipStatus[party] && <small className="zip-status">{zipStatus[party]}</small>}</label>
                          <label>{tx("State / Prov")}<input required maxLength={2} value={details.state} onChange={(event) => updateBookingParty(party, "state", event.target.value.toUpperCase())} /></label>
                          <label>{tx("City")}{bookingCities[party].length > 1 ? <select required value={details.city} onChange={(event) => updateBookingParty(party, "city", event.target.value)}>{bookingCities[party].map((city) => <option key={city} value={city}>{city}</option>)}</select> : <input required value={details.city} onChange={(event) => updateBookingParty(party, "city", event.target.value)} />}</label>
                        </div>
                        <div className="booking-phone-row">
                          <label>{tx("Phone number")}<input type="tel" inputMode="tel" pattern={"\\([0-9]{3}\\) [0-9]{3}-[0-9]{4}"} title="Enter a 10-digit phone number / 请输入10位电话号码" required value={details.phone} onChange={(event) => updateBookingParty(party, "phone", formatPhoneInput(event.target.value))} onBlur={(event) => updateBookingParty(party, "phone", formatPhoneInput(event.target.value))} /></label>
                          <label>{tx("Extension")} <small>{tx("Optional")}</small><input inputMode="numeric" value={details.extension} onChange={(event) => updateBookingParty(party, "extension", event.target.value)} /></label>
                        </div>
                        <label>{tx("Contact name")}<input required value={details.contact} onChange={(event) => updateBookingParty(party, "contact", event.target.value)} /></label>
                        <label>{tx("Email")} <small>{tx("Optional")}</small><input type="email" value={details.email} onChange={(event) => updateBookingParty(party, "email", event.target.value)} /></label>
                        {party === "receiver" && <div className="settings-two">
                          <label>{language === "zh" ? "送货开始时间（收货地时间）" : "Delivery start (local time)"}<input required type="time" value={details.deliveryStartTime || "08:00"} onChange={(event) => updateBookingParty(party, "deliveryStartTime", event.target.value)} /></label>
                          <label>{language === "zh" ? "送货截止时间（收货地时间）" : "Delivery end (local time)"}<input required type="time" min={details.deliveryStartTime || "08:00"} value={details.deliveryEndTime || "17:00"} onChange={(event) => updateBookingParty(party, "deliveryEndTime", event.target.value)} /></label>
                        </div>}
                        <label>{tx("Save")}<select value={details.save} onChange={(event) => updateBookingParty(party, "save", event.target.value)}><option value="no">{tx("Do not save")}</option><option value="new">{tx("Save to address book")}</option></select></label>
                      </fieldset>
                    );
                  })}
                </div>
                <div className="booking-bottom"><label>{tx("Reference / PO")}<input required value={bookingDetails.reference} onChange={(event) => setBookingDetails((current) => ({ ...current, reference: event.target.value }))} /></label><p>{language === "zh" ? <><strong>${rates[selectedRate].price.toFixed(2)}</strong> 只会在生成 BOL 后扣除。</> : <><strong>${rates[selectedRate].price.toFixed(2)}</strong> will be deducted only after the BOL is generated.</>}</p><div className="booking-actions"><button type="submit" value="save" disabled={savingBooking}>{savingBooking ? tx("Please wait…") : tx("Save booking details")}</button>{authUser?.canSelfBook ? <button type="submit" value="generate" className="generate-bol" disabled={savingBooking}>{savingBooking ? tx("Please wait…") : tx("Generate BOL")}</button> : <span className="booking-disabled-note">{tx("BOL approval required")}</span>}</div></div>
                {bookingMessage && <p className="booking-message" role="status">{bookingMessage}</p>}
              </form>
            </section>
          )}
        </div>

        <div className="content quotes-content" hidden={view !== "quotes"}>
          <section className="page-heading saved-quotes-heading">
            <div><p className="eyebrow">{tx("SAVED QUOTES")}</p><h1>{tx("Quotes")}</h1><p>{tx("Saved booking details and selected carrier rates appear here.")}</p></div>
            <div className="history-actions"><input type="search" value={historySearch} onChange={(event) => setHistorySearch(event.target.value)} placeholder={language === "zh" ? "报价单、PO、邮编、客户、承运商" : "Quote, PO, ZIP, customer, carrier"} aria-label="Search quotes" /><button type="button" className="new-quote-button" onClick={() => setView("new")}>＋ {tx("New quote")}</button></div>
          </section>
          <section className="panel saved-quotes-panel">
            {savedQuotesError && <p className="quotes-error" role="alert">{savedQuotesError}</p>}
            {savedQuotesNotice && <p className="quotes-success" role="status">{savedQuotesNotice}</p>}
            {savedQuotesLoading ? (
              <p className="quotes-empty">{tx("Loading quotes…")}</p>
            ) : filteredQuotes.length === 0 ? (
              <div className="quotes-empty"><strong>{tx(savedQuotes.length ? "No matching quotes." : "No saved quotes yet.")}</strong><span>{savedQuotes.length ? tx("Try another search.") : language === "zh" ? "填写并保存下单资料，即可创建第一份草稿报价。" : "Complete booking details and save to create the first draft quote."}</span></div>
            ) : (
              <div className="quotes-table-wrap">
                <table className="quotes-table">
                  <thead><tr><th>{tx("Quote")}</th><th>Reference / PO</th><th>{tx("Route")}</th><th>{tx("Customer")}</th><th>{tx("Carrier")}</th><th>{tx("Ship date")}</th><th>{tx("Status")}</th><th>{tx("Price")}</th><th>{tx("Action")}</th></tr></thead>
                  <tbody>{filteredQuotes.map((quote) => (
                    <tr key={quote.id}>
                      <td><strong>{quote.quote_number}</strong><small>{new Date(quote.created_at).toLocaleDateString(language === "zh" ? "zh-CN" : "en-US")}</small></td>
                      <td>{quote.reference}</td>
                      <td>{quote.origin_zip} → {quote.destination_zip}</td>
                      <td>{quote.receiver?.company || "—"}</td>
                      <td><strong>{quote.carrier}</strong><small>{quote.service}</small></td>
                      <td>{quote.ready_date || "—"}</td>
                      <td><span className={`quote-status ${quote.status}`}>{statusLabel(quote.status)}</span></td>
                      <td className="quote-price">${Number(quote.price).toFixed(2)}</td>
                      <td><div className="quote-actions">{authUser?.role === "admin" && <button type="button" className="secondary-action" onClick={() => setReleaseQuoteId(quote.id)}>{language === "zh" ? (quote.status === "booking" ? "释放预留 / 审计" : "释放记录") : (quote.status === "booking" ? "Release / audit" : "Release audit")}</button>}{quote.status === "booking" && (authUser?.role === "admin" ? <button type="button" disabled={quoteActionId === quote.id} onClick={() => void generateBol(quote.id, true)}>{language === "zh" ? "核对已有运单" : "Reconcile existing shipment"}</button> : <span>{language === "zh" ? "请联系管理员核对；勿重复下单" : "Contact an administrator; do not rebook"}</span>)}{quote.status === "draft" && (authUser?.canSelfBook ? <button type="button" onClick={() => confirmAndGenerateBol(quote)} disabled={quoteActionId === quote.id}>{quoteActionId === quote.id ? (language === "zh" ? "生成中…" : "Generating…") : tx("Generate BOL")}</button> : <span>{tx("BOL approval required")}</span>)}{quote.status === "booked" && <>{quote.bol_url ? <a href={quote.bol_url} target="_blank" rel="noreferrer">{tx("Download BOL")}</a> : <span className="bol-number">BOL {quote.bol_number}</span>}<button type="button" className="void-button" onClick={() => void voidShipment(quote)} disabled={!authUser?.canSelfBook || quoteActionId === quote.id}>{quoteActionId === quote.id ? (language === "zh" ? "取消中…" : "Cancelling…") : tx("Void shipment")}</button></>}{quote.status === "booking" && <span>{language === "zh" ? "下单中…" : "Booking…"}</span>}{quote.status === "void" && <span>{tx("Pickup cancelled")}</span>}<button type="button" className="secondary-action" disabled={quote.status === "booking"} onClick={() => copyQuoteForRequote(quote)}>{tx("Copy & requote")}</button></div></td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            )}
          </section>
        </div>

        <div className="content workspace-page" hidden={view !== "orders"}>
          <section className="page-heading"><div><p className="eyebrow">{tx("SHIPMENTS")}</p><h1>{tx("Orders")}</h1><p>{tx("Generated BOLs and cancelled shipments appear here.")}</p></div><div className="history-actions"><input type="search" value={historySearch} onChange={(event) => setHistorySearch(event.target.value)} placeholder={language === "zh" ? "BOL、PO、邮编、客户、承运商" : "BOL, PO, ZIP, customer, carrier"} aria-label="Search orders" /></div></section>
          {savedQuotesError && <p className="quotes-error" role="alert">{savedQuotesError}</p>}
          {savedQuotesNotice && <p className="quotes-success" role="status">{savedQuotesNotice}</p>}
          <section className="panel saved-quotes-panel">
            {savedQuotesLoading ? <p className="quotes-empty">{tx("Loading orders…")}</p> : filteredOrders.length === 0 ? <div className="quotes-empty"><strong>{tx(historySearch ? "No matching orders." : "No orders yet.")}</strong><span>{historySearch ? tx("Try another search.") : language === "zh" ? "生成 BOL 后，订单会显示在这里。" : "Orders appear after a BOL is generated."}</span></div> : <div className="quotes-table-wrap"><table className="quotes-table orders-table"><thead><tr><th>BOL</th><th>Reference / PO</th><th>{tx("Route")}</th><th>{tx("Customer")}</th><th>{tx("Carrier")}</th><th>{tx("Ship date")}</th><th>{tx("Status")}</th><th>{tx("Price")}</th><th>{tx("Action")}</th></tr></thead><tbody>{filteredOrders.map((quote) => <tr key={quote.id}><td><strong>{quote.bol_number || "—"}</strong><small>{quote.quote_number}</small></td><td>{quote.reference}</td><td>{quote.origin_zip} → {quote.destination_zip}</td><td>{quote.receiver?.company || "—"}</td><td><strong>{quote.carrier}</strong><small>{quote.service}</small></td><td>{quote.ready_date || "—"}</td><td><span className={`quote-status ${quote.status}`}>{quote.status}</span></td><td className="quote-price">${Number(quote.price).toFixed(2)}</td><td><div className="quote-actions order-actions"><button type="button" onClick={() => setSelectedOrder(quote)}>{tx("View details")}</button><details><summary>{language === "zh" ? "更多" : "More"}</summary><div className="order-action-options">{quote.bol_url && <a href={quote.bol_url} target="_blank" rel="noreferrer">{tx("Download BOL")}</a>}{quote.status === "booked" && quote.bol_number && <button type="button" onClick={() => { if (!printBol(quote)) window.alert(language === "zh" ? "请允许弹出窗口后重试。" : "Allow pop-ups and try again."); }}>{language === "zh" ? "打印 BOL" : "Print BOL"}</button>}{quote.status === "booked" && quote.bol_number && <button type="button" onClick={() => { if (!printShippingLabel(quote)) window.alert(language === "zh" ? "请允许弹出窗口后重试。" : "Allow pop-ups and try again."); }}>{language === "zh" ? "打印运输标签" : "Pallet Label"}</button>}{quote.status === "booked" ? <button type="button" className="void-button" onClick={() => void voidShipment(quote)} disabled={!authUser?.canSelfBook || quoteActionId === quote.id}>{quoteActionId === quote.id ? (language === "zh" ? "取消中…" : "Cancelling…") : tx("Void shipment")}</button> : <span>{tx("Pickup cancelled")}</span>}<button type="button" className="secondary-action" disabled={quote.status === "booking"} onClick={() => copyQuoteForRequote(quote)}>{tx("Copy & requote")}</button></div></details></div></td></tr>)}</tbody></table></div>}
          </section>
        </div>

        <div className="content workspace-page" hidden={view !== "addresses"}>
          <section className="page-heading"><div><p className="eyebrow">{tx("SAVED LOCATIONS")}</p><h1>{tx("Address book")}</h1><p>{tx("Manage frequently used sender and receiver addresses.")}</p></div></section>
          <div className="address-page-grid">
            <section className="panel address-create-panel"><h2>{tx(editingAddressId ? "Edit address" : "Add address")}</h2><form onSubmit={addAddress} className="address-create-form"><fieldset className="address-category-options"><legend>{tx("Address category")} *</legend>{(["sender", "receiver"] as const).map((role) => <label key={role}><input type="checkbox" checked={addressCategory === role || addressCategory === "both"} onChange={(event) => { const checked = event.target.checked; const otherRole = role === "sender" ? "receiver" : "sender"; setAddressCategory((current) => checked ? (current === otherRole ? "both" : role) : (current === "both" ? otherRole : "")); }} />{tx(role === "sender" ? "Shipper" : "Consignee")}</label>)}</fieldset><label>{tx("Company or name")}<input required value={newAddress.company} onChange={(event) => void updateNewAddress("company", event.target.value)} /></label><label>{tx("Address 1")}<input required value={newAddress.address1} onChange={(event) => void updateNewAddress("address1", event.target.value)} /></label><label>{tx("Address 2")} <small>{tx("Optional")}</small><input value={newAddress.address2} onChange={(event) => void updateNewAddress("address2", event.target.value)} /></label><div className="address-location-row"><label>{tx("Postal code")}<input required maxLength={5} inputMode="numeric" value={newAddress.zip} onChange={(event) => void updateNewAddress("zip", event.target.value.replace(/\D/g, "").slice(0, 5))} /></label><label>{tx("State")}<input required maxLength={2} value={newAddress.state} onChange={(event) => void updateNewAddress("state", event.target.value.toUpperCase())} /></label><label>{tx("City")}<input required value={newAddress.city} onChange={(event) => void updateNewAddress("city", event.target.value)} /></label></div><div className="address-location-row"><label>{tx("Contact")}<input value={newAddress.contact} onChange={(event) => void updateNewAddress("contact", event.target.value)} /></label><label className="span-two">{tx("Phone")}<input type="tel" inputMode="tel" pattern={"\\([0-9]{3}\\) [0-9]{3}-[0-9]{4}"} title="Enter a 10-digit phone number / 请输入10位电话号码" value={newAddress.phone} onChange={(event) => void updateNewAddress("phone", formatPhoneInput(event.target.value))} onBlur={(event) => void updateNewAddress("phone", formatPhoneInput(event.target.value))} /></label></div><label>{tx("Email")} <small>{tx("Optional")}</small><input type="email" value={newAddress.email} onChange={(event) => void updateNewAddress("email", event.target.value)} /></label><div className="address-form-actions"><button type="submit" disabled={savingAddress}>{savingAddress ? tx("Please wait…") : tx(editingAddressId ? "Update address" : "Save address")}</button>{editingAddressId && <button type="button" className="secondary-action" onClick={cancelAddressEdit}>{tx("Cancel")}</button>}</div></form>{addressPageMessage && <p className="settings-success">{addressPageMessage}</p>}{addressBookError && <p className="address-book-error">{addressBookError}</p>}</section>
            <section className="panel address-directory"><div className="directory-heading"><h2>{tx("Saved addresses")}</h2><span>{addressBookEntries.length}</span></div>{addressBookLoading ? <p className="address-book-empty">{tx("Loading addresses…")}</p> : addressBookEntries.length === 0 ? <p className="address-book-empty">{tx("No saved addresses yet.")}</p> : <div className="address-book-list">{addressBookEntries.map((entry) => <div className="address-book-card" key={entry.id}><div className="address-book-select"><div className="saved-address-heading"><strong>{entry.company}</strong><span className="saved-address-category" data-category={entry.category ?? undefined}>{tx(entry.category === "sender" ? "Shipper" : entry.category === "receiver" ? "Consignee" : entry.category === "both" ? "Shipper and consignee" : "Uncategorized")}</span></div><span>{[entry.address1, entry.address2, entry.city, [entry.state, entry.zip].filter(Boolean).join(" ")].filter(Boolean).join(", ")}</span>{(entry.contact || entry.phone) && <small>{[entry.contact, entry.phone].filter(Boolean).join(" · ")}</small>}</div><div className="address-card-actions"><button type="button" className="address-book-edit" onClick={() => editAddress(entry)}>{tx("Edit")}</button><button type="button" className="address-book-delete" onClick={() => void deleteAddress(entry)} disabled={deletingAddressId === entry.id}>{deletingAddressId === entry.id ? (language === "zh" ? "删除中…" : "Deleting…") : tx("Delete")}</button></div></div>)}</div>}</section>
          </div>
        </div>

        <div className="content workspace-page" hidden={view !== "deposit"}>
          <section className="page-heading"><div><p className="eyebrow">{tx("ACCOUNT BALANCE")}</p><h1>{tx("Deposit")}</h1><p>{tx("BOL charges and void refunds are recorded automatically.")}</p></div><div className="deposit-balance-large"><span>{platformAdmin ? `${language === "zh" ? "当前工作区" : "Current workspace"}: ${authUser?.customerName || "—"}` : tx("Available balance")}</span><strong>${deposit.toLocaleString(language === "zh" ? "zh-CN" : "en-US", { minimumFractionDigits: 2 })}</strong></div></section>
          {platformAdmin && view === "deposit" && <AdminDepositOverview language={language} refreshKey={depositOverviewVersion} onAdjusted={(customerId, balance) => { if (customerId === authUser?.customerId) setDeposit(balance); }} />}
          {depositError && <p className="quotes-error" role="alert">{depositError}</p>}
          {!platformAdmin && <>
          <div className={`deposit-page-grid ${!platformAdmin ? "ledger-only" : ""}`}>
            <section className="panel deposit-ledger"><h2>{tx("Activity")}</h2>{depositLoading ? <p className="quotes-empty">{tx("Loading activity…")}</p> : depositTransactions.length === 0 ? <p className="quotes-empty">{tx("No deposit activity yet.")}</p> : <div className="deposit-rows">{depositTransactions.map((transaction) => { const amount = Number(transaction.amount); const labels: Record<DepositTransaction["transaction_type"], string> = language === "zh" ? { DEPOSIT: "押金充值", ADJUSTMENT: "手工调整", BOL_RESERVE: "生成 BOL 扣款", BOOKING_RELEASE: "订单扣款释放", VOID_REFUND: "取消运单退款" } : { DEPOSIT: "Deposit payment", ADJUSTMENT: "Manual adjustment", BOL_RESERVE: "BOL generated", BOOKING_RELEASE: "Booking charge released", VOID_REFUND: "Void refund" }; const detail = transaction.reason || (transaction.saved_quotes ? `${transaction.saved_quotes.quote_number} · ${transaction.saved_quotes.reference || (language === "zh" ? "无 Reference" : "No reference")}` : language === "zh" ? "账户余额" : "Account balance"); return <div className="deposit-row" key={transaction.id}><span className={`deposit-change ${amount >= 0 ? "positive" : "negative"}`}>{amount >= 0 ? "+" : "−"}${Math.abs(amount).toFixed(2)}</span><div><strong>{labels[transaction.transaction_type]}</strong><small>{detail}</small></div><time>{new Date(transaction.created_at).toLocaleString(language === "zh" ? "zh-CN" : "en-US")}</time><span className="balance-after">${Number(transaction.balance_after).toFixed(2)}</span></div>; })}</div>}</section>
          </div></>}
        </div>

        {view === "customers" && customerAdmin && authUser && <CompanyAccount
          language={language} customerName={authUser.customerName} currentUserId={authUser.userId}
          users={customers.find((customer) => customer.id === authUser.customerId)?.app_users ?? []}
          roleLabels={userRoleLabels} loading={customersLoading} error={customersError} createForm={createLoginUserForm}
          onProfile={() => { setAccountBack("customers"); setView("account"); }}
          onQuotes={() => void showSavedQuotes()} onQuoteInputs={() => setView("quote-inputs")} onSave={updateUser} />}

        {view === "quote-inputs" && (platformAdmin || customerAdmin) && authUser && <QuoteInputHistory
          key={`${authUser.userId}:${authUser.customerId}`} language={language}
          companyName={platformAdmin ? (language === "zh" ? "所有客户" : "All customers") : authUser.customerName}
          onUsers={() => void showCustomers()} onProfile={() => { setAccountBack("quote-inputs"); setView("account"); }}
          onQuotes={() => void showSavedQuotes()} />}

        <div className="content workspace-page company-admin-page" hidden={view !== "customers" || !platformAdmin}>
          <section className="page-heading">
            <div><h1>{language === "zh" ? "公司账户" : "Company Account"}</h1><p>{tx("Create customer workspaces, control pricing, and choose which customer you are working on.")}</p></div>
            <nav className="company-account-nav" aria-label="Company Account">
              <button type="button" onClick={() => { setAccountBack("customers"); setView("account"); }}>{language === "zh" ? "个人资料" : "Profile"}</button>
              <span aria-current="page">{language === "zh" ? "客户和用户" : "Customers & users"}</span>
              <button type="button" onClick={() => setView("quote-inputs")}>Quote input</button>
              <button type="button" onClick={() => void showSavedQuotes()}>{tx("Quotes")}</button>
            </nav>
          </section>
          {customersError && <p className="quotes-error" role="alert">{customersError}</p>}
          {customersNotice && <p className="settings-success" role="status">{customersNotice}</p>}
          <div className="customers-page-grid">
            <div className="customer-admin-column">
            {platformAdmin && <details className="panel customer-create-panel"><summary>{tx("Add customer")}</summary><form onSubmit={createCustomer} className="customer-form"><label>{tx("Customer name")}<input required value={customerForm.name} onChange={(event) => setCustomerForm((current) => ({ ...current, name: event.target.value }))} /></label><label>{tx("Customer code")}<input required value={customerForm.code} onChange={(event) => setCustomerForm((current) => ({ ...current, code: event.target.value.toUpperCase().replace(/[^A-Z0-9_-]/g, "") }))} placeholder="ACME" /></label><div className="settings-two"><label>{tx("Markup percent")}<input type="number" min="0" step="0.01" value={customerForm.markupPercent} onChange={(event) => setCustomerForm((current) => ({ ...current, markupPercent: event.target.value }))} /></label><label>{tx("Minimum markup")}<input type="number" min="0" step="0.01" value={customerForm.minimumMarkup} onChange={(event) => setCustomerForm((current) => ({ ...current, minimumMarkup: event.target.value }))} /></label></div><label className="customer-check"><input type="checkbox" checked={customerForm.canSelfBook} onChange={(event) => setCustomerForm((current) => ({ ...current, canSelfBook: event.target.checked }))} />{tx("Customer may generate BOLs")}</label><div className="customer-user-fields"><h3>{tx("First login user")} <small>{tx("Optional")}</small></h3><label>{tx("Name")}<input value={customerForm.userName} onChange={(event) => setCustomerForm((current) => ({ ...current, userName: event.target.value }))} /></label><label>{tx("Email")}<input type="email" value={customerForm.email} onChange={(event) => setCustomerForm((current) => ({ ...current, email: event.target.value }))} /></label><label>{tx("Temporary password")}<input type="password" minLength={8} value={customerForm.password} onChange={(event) => setCustomerForm((current) => ({ ...current, password: event.target.value }))} /></label></div><button type="submit" disabled={customersLoading}>{customersLoading ? tx("Please wait…") : tx("Create customer")}</button></form></details>}
            <details className="panel customer-create-panel"><summary>{tx("Add login user")}</summary>{createLoginUserForm}</details>
            </div>
            {platformAdmin && <CustomerWorkspaces customers={customers} currentId={authUser?.customerId ?? null} language={language} loading={customersLoading} onSelect={selectCustomer} onSave={updateCustomer} onDelete={deleteCustomer} />}
          {view === "customers" && platformAdmin && adminEditId && <AdminUserEditor key={adminEditId} id={adminEditId} language={language} customers={customers} onClose={() => setAdminEditId(null)} onSaved={showCustomers} />}
          <section className="panel users-directory">
            <div className="directory-heading"><h2>{tx("Login users")}</h2><span>{customers.reduce((total, customer) => total + (customer.app_users?.length || 0), 0)}</span></div>
            <div className="company-users-list admin-users-list">
              <table aria-label={tx("Login users")}>
                <thead><tr>
                  <th scope="col">{tx("Name")}</th><th scope="col">{tx("Email")}</th><th scope="col">{tx("Customer")}</th>
                  <th scope="col">{tx("Role")}</th><th scope="col">{tx("Status")}</th><th scope="col">{tx("Action")}</th>
                </tr></thead>
                <tbody>{customers.flatMap((customer) => (customer.app_users || []).map((user) => <tr key={user.user_id}>
                  <td><div className="user-name-with-current"><strong>{user.full_name}</strong>{user.user_id === authUser?.userId && <span className="current-user-badge">{language === "zh" ? "当前用户" : "Current"}</span>}</div></td><td>{user.email}</td><td>{customer.name}</td>
                  <td><span className="user-role-badge" data-role={user.role}>{userRoleLabels[user.role] ?? user.role}</span></td>
                  <td><span className="company-user-status" data-active={user.active}>{user.active ? tx("Active") : language === "zh" ? "已停用" : "Inactive"}</span></td>
                  <td><div className="company-user-actions">
                    <button type="button" className="company-user-link" onClick={() => setAdminEditId(user.user_id)}>{language === "zh" ? "编辑" : "Edit"}</button>
                    {user.user_id !== authUser?.userId && <details className="company-user-more">
                      <summary aria-label={`${language === "zh" ? "更多操作" : "More actions"} · ${user.full_name}`}>⋮</summary>
                      <div><button type="button" className="danger-button" disabled={customersLoading} onClick={(event) => {
                        event.currentTarget.closest("details")?.removeAttribute("open");
                        void deleteUser(user);
                      }}>{tx("Delete")}</button></div>
                    </details>}
                  </div></td>
                </tr>))}</tbody>
              </table>
            </div>
          </section>
          </div>
        </div>

        {view === "account" && authUser && <MyAccount key={`${authUser.userId}:${authUser.customerId}`} language={language} user={authUser}
          onBack={() => setView(accountBack)} onAddressBook={() => void showAddressBookPage()} onQuotes={() => void showSavedQuotes()} />}

        <div className="content workspace-page" hidden={view !== "settings"}>
          <section className="page-heading"><div><p className="eyebrow">{tx("PLATFORM DEFAULTS")}</p><h1>{tx("Settings")}</h1><p>{tx("These defaults are applied when preparing new bookings.")}</p></div></section>
          <section className="panel settings-panel">{settingsError && <p className="quotes-error" role="alert">{settingsError}</p>}{settingsLoading && !settings.company_name ? <p className="quotes-empty">{language === "zh" ? "正在加载设置…" : "Loading settings…"}</p> : <form onSubmit={saveSettings} className="settings-form"><label>{tx("Company name")}<input required value={settings.company_name} onChange={(event) => setSettings((current) => ({ ...current, company_name: event.target.value }))} /></label><div className="settings-two"><label>{tx("Default contact")}<input value={settings.contact_name} onChange={(event) => setSettings((current) => ({ ...current, contact_name: event.target.value }))} /></label><label>{tx("Phone")}<input type="tel" inputMode="tel" pattern={"\\([0-9]{3}\\) [0-9]{3}-[0-9]{4}"} title="Enter a 10-digit phone number / 请输入10位电话号码" value={settings.phone} onChange={(event) => setSettings((current) => ({ ...current, phone: formatPhoneInput(event.target.value) }))} onBlur={(event) => { const phone = formatPhoneInput(event.target.value); setSettings((current) => ({ ...current, phone })); }} /></label></div><label>{tx("Email")}<input type="email" value={settings.email} onChange={(event) => setSettings((current) => ({ ...current, email: event.target.value }))} /></label><div className="settings-two"><label>{tx("Default ready time")}<input type="time" value={settings.default_ready_time} onChange={(event) => setSettings((current) => ({ ...current, default_ready_time: event.target.value }))} /></label><label>{tx("Default close time")}<input type="time" value={settings.default_close_time} onChange={(event) => setSettings((current) => ({ ...current, default_close_time: event.target.value }))} /></label></div><div className="settings-section"><h2>{tx("Customer pricing")}</h2><p>{language === "zh" ? "显示价格为承运商成本加上百分比加价或最低加价中较高的一项。" : "The displayed rate is carrier cost plus the greater of percentage markup or minimum markup."}</p><div className="settings-two"><label>{tx("Markup percent")}<input type="number" min="0" step="0.01" value={settings.markup_percent} onChange={(event) => setSettings((current) => ({ ...current, markup_percent: Number(event.target.value) }))} /></label><label>{tx("Minimum markup (USD)")}<input type="number" min="0" step="0.01" value={settings.minimum_markup} onChange={(event) => setSettings((current) => ({ ...current, minimum_markup: Number(event.target.value) }))} /></label></div></div><div className="settings-section"><h2>{tx("Rate providers")}</h2><div className="provider-toggles"><label><input type="checkbox" checked={settings.wwex_enabled} onChange={(event) => setSettings((current) => ({ ...current, wwex_enabled: event.target.checked }))} /><span><strong>WWEX</strong><small>{language === "zh" ? "包含 WWEX 报价" : "Include WWEX rates"}</small></span></label><label><input type="checkbox" checked={settings.priority1_enabled} onChange={(event) => setSettings((current) => ({ ...current, priority1_enabled: event.target.checked }))} /><span><strong>Priority1</strong><small>{language === "zh" ? "包含 Priority1 报价" : "Include Priority1 rates"}</small></span></label><label><input type="checkbox" checked={settings.tql_enabled} onChange={(event) => setSettings((current) => ({ ...current, tql_enabled: event.target.checked }))} /><span><strong>TQL</strong><small>{language === "zh" ? "包含 TQL 报价" : "Include TQL rates"}</small></span></label><label><input type="checkbox" checked={settings.mothership_enabled !== false} onChange={(event) => setSettings((current) => ({ ...current, mothership_enabled: event.target.checked }))} /><span><strong>Mothership</strong><small>{language === "zh" ? "包含 Mothership 报价" : "Include Mothership rates"}</small></span></label></div></div><button type="submit" disabled={settingsLoading || (!settings.wwex_enabled && !settings.priority1_enabled && !settings.tql_enabled && settings.mothership_enabled === false)}>{settingsLoading ? tx("Please wait…") : tx("Save settings")}</button>{!settings.wwex_enabled && !settings.priority1_enabled && !settings.tql_enabled && settings.mothership_enabled === false && <small className="settings-warning">{language === "zh" ? "请至少启用一个报价渠道。" : "Keep at least one rate provider enabled."}</small>}</form>}{settingsMessage && <p className="settings-success" role="status">{settingsMessage}</p>}</section>
        </div>
      </main>
      {helpOpen && (
        <div className="address-book-backdrop" role="presentation" onMouseDown={() => setHelpOpen(false)}>
          <section className="help-dialog" role="dialog" aria-modal="true" aria-labelledby="help-title" onMouseDown={(event) => event.stopPropagation()}>
            <header>
              <div><p className="eyebrow">{language === "zh" ? "使用说明" : "QUICK GUIDE"}</p><h2 id="help-title">{language === "zh" ? "平台帮助" : "Platform help"}</h2><span>{language === "zh" ? "LTL 报价与生成 BOL 的基本流程" : "The basic LTL quote and BOL workflow"}</span></div>
              <button type="button" onClick={() => setHelpOpen(false)} aria-label={language === "zh" ? "关闭帮助" : "Close help"}>×</button>
            </header>
            <div className="help-list">{helpItems.map((item) => <article key={item.title}><h3>{item.title}</h3><p>{item.body}</p></article>)}</div>
            <footer><button type="button" onClick={() => setHelpOpen(false)}>{language === "zh" ? "知道了" : "Got it"}</button></footer>
          </section>
        </div>
      )}
      {selectedOrder && (
        <div className="address-book-backdrop" role="presentation" onMouseDown={() => setSelectedOrder(null)}>
          <section className="order-detail-dialog" role="dialog" aria-modal="true" aria-labelledby="order-detail-title" onMouseDown={(event) => event.stopPropagation()}>
            <header><div><p className="eyebrow">{language === "zh" ? "运输详情" : "SHIPMENT DETAILS"}</p><h2 id="order-detail-title">{selectedOrder.bol_number || selectedOrder.quote_number}</h2><span>{selectedOrder.carrier} · {selectedOrder.service}</span></div><button type="button" onClick={() => setSelectedOrder(null)} aria-label="Close order details">×</button></header>
            <div className="order-summary-grid"><div><span>{tx("Status")}</span><strong className={`quote-status ${selectedOrder.status}`}>{statusLabel(selectedOrder.status)}</strong></div><div><span>Reference / PO</span><strong>{selectedOrder.reference || "—"}</strong></div><div><span>{tx("Ship date")}</span><strong>{selectedOrder.ready_date || "—"}</strong></div><div><span>{tx("Total")}</span><strong>${Number(selectedOrder.price).toFixed(2)}</strong></div></div>
            <div className="order-parties"><article><span>{tx("Shipper")}</span><strong>{selectedOrder.sender.company}</strong><p>{selectedOrder.sender.address1}{selectedOrder.sender.address2 ? `, ${selectedOrder.sender.address2}` : ""}<br />{selectedOrder.sender.city}, {selectedOrder.sender.state} {selectedOrder.sender.zip}<br />{selectedOrder.sender.contact} · {selectedOrder.sender.phone}</p></article><article><span>{tx("Consignee")}</span><strong>{selectedOrder.receiver.company}</strong><p>{selectedOrder.receiver.address1}{selectedOrder.receiver.address2 ? `, ${selectedOrder.receiver.address2}` : ""}<br />{selectedOrder.receiver.city}, {selectedOrder.receiver.state} {selectedOrder.receiver.zip}<br />{selectedOrder.receiver.contact} · {selectedOrder.receiver.phone}{selectedOrder.receiver.deliveryStartTime && <><br />{language === "zh" ? "送货时间（收货地）" : "Delivery hours (local)"}: {selectedOrder.receiver.deliveryStartTime}–{selectedOrder.receiver.deliveryEndTime}</>}</p></article></div>
            <div className="order-freight"><h3>{tx("Freight")}</h3>{selectedOrder.freight_items.map((item, index) => <div key={`${selectedOrder.id}-${index}`}><strong>{language === "zh" ? "货物行" : "Line"} {index + 1} · {item.pallets} {item.packaging} · {item.pieces ?? item.pallets} {language === "zh" ? "件" : "pieces"}</strong><span>{item.length} × {item.width} × {item.height} in · {item.unitWeight} lb {language === "zh" ? "每托" : "each"} · {item.totalWeight ?? Math.ceil(Number(item.pallets) * Number(item.unitWeight))} lb {language === "zh" ? "总重" : "total"} · Class {item.freightClass || "—"}{item.nmfc ? ` · NMFC ${item.nmfc}` : ""}</span><small>{item.commodity || (language === "zh" ? "未填写品名" : "Commodity not provided")}{item.hazmat ? (language === "zh" ? " · 危险品" : " · Hazmat") : ""}{item.stackable ? (language === "zh" ? " · 可堆叠" : " · Stackable") : (language === "zh" ? " · 不可堆叠" : " · Non-stackable")}</small></div>)}</div>
            {selectedOrder.services?.length > 0 && <div className="order-services"><h3>{tx("Additional services")}</h3><p>{selectedOrder.services.map(tx).join(" · ")}</p></div>}
            <footer>{selectedOrder.bol_url && <a href={selectedOrder.bol_url} target="_blank" rel="noreferrer">{tx("Download BOL")}</a>}<button type="button" className="secondary-action" onClick={() => copyQuoteForRequote(selectedOrder)}>{tx("Copy & requote")}</button>{selectedOrder.status === "booked" && <button type="button" className="void-button" onClick={() => void voidShipment(selectedOrder)} disabled={quoteActionId === selectedOrder.id}>{quoteActionId === selectedOrder.id ? (language === "zh" ? "取消中…" : "Cancelling…") : tx("Void shipment")}</button>}</footer>
          </section>
        </div>
      )}
      {releaseQuoteId && <BookingReleaseDialog quoteId={releaseQuoteId} language={language} onClose={() => setReleaseQuoteId(null)} onReleased={(released) => { setReleaseQuoteId(null); void showSavedQuotes(); setSavedQuotesNotice(released ? (language === "zh" ? "押金预留已释放，原因和操作人已记录。" : "Deposit reservation released; evidence and actor audited.") : (language === "zh" ? "该预留状态已改变，请查看最新记录。" : "Reservation state already changed; check the latest record.")); }} />}
      {pendingBolQuote && (
        <div className="address-book-backdrop" role="presentation" onMouseDown={() => setPendingBolQuote(null)}>
          <section className="help-dialog" role="dialog" aria-modal="true" aria-labelledby="bol-confirm-title" onMouseDown={(event) => event.stopPropagation()}>
            <header>
              <div><p className="eyebrow">{language === "zh" ? "确认下单" : "CONFIRM BOOKING"}</p><h2 id="bol-confirm-title">{tx("Generate BOL")}</h2><span>{pendingBolQuote.quote_number} · {pendingBolQuote.carrier}</span></div>
              <button type="button" onClick={() => setPendingBolQuote(null)} aria-label={language === "zh" ? "关闭确认" : "Close confirmation"}>×</button>
            </header>
            <p>{language === "zh" ? `系统将生成 BOL、向承运商预约 Pickup，并从押金扣除 $${Number(pendingBolQuote.price).toFixed(2)}。` : `A BOL will be generated, carrier pickup will be scheduled, and $${Number(pendingBolQuote.price).toFixed(2)} will be deducted from the deposit.`}</p>
            <footer><button type="button" className="secondary-action" onClick={() => setPendingBolQuote(null)}>{language === "zh" ? "取消" : "Cancel"}</button><button type="button" onClick={() => { const quoteId = pendingBolQuote.id; setPendingBolQuote(null); void generateBol(quoteId); }}>{language === "zh" ? "确认生成" : "Confirm and generate"}</button></footer>
          </section>
        </div>
      )}
      {addressBookTarget && (
        <div className="address-book-backdrop" role="presentation" onMouseDown={() => setAddressBookTarget(null)}>
          <section className="address-book-dialog" role="dialog" aria-modal="true" aria-labelledby="address-book-title" onMouseDown={(event) => event.stopPropagation()}>
            <header><div><p className="eyebrow">{language === "zh" ? "已保存地址" : "SAVED ADDRESSES"}</p><h2 id="address-book-title">{language === "zh" ? `选择${addressBookTarget === "sender" || addressBookTarget === "route-origin" ? "发货人" : "收货人"}` : `Choose ${addressBookTarget === "sender" || addressBookTarget === "route-origin" ? "shipper" : "consignee"}`}</h2></div><button type="button" onClick={() => setAddressBookTarget(null)} aria-label="Close address book">×</button></header>
            {addressBookError && <p className="address-book-error" role="alert">{addressBookError}</p>}
            {addressBookLoading ? <p className="address-book-empty">{tx("Loading addresses…")}</p> : pickerAddresses.length === 0 ? <p className="address-book-empty">{language === "zh" ? "暂时没有已保存地址。保存下单资料时选择“保存到地址簿”即可添加。" : "No saved addresses yet. Choose “Save to address book” when saving booking details."}</p> : <div className="address-book-list">{pickerAddresses.map((entry) => <div className="address-book-card" key={entry.id}><button type="button" className="address-book-select" onClick={() => chooseAddress(entry)}><strong>{entry.company}</strong><span>{entry.address1}{entry.address2 ? `, ${entry.address2}` : ""}</span><span>{entry.city}, {entry.state} {entry.zip}</span><small>{entry.contact}{entry.phone ? ` · ${entry.phone}` : ""}</small></button><button type="button" className="address-book-delete" onClick={() => void deleteAddress(entry)} disabled={deletingAddressId === entry.id}>{deletingAddressId === entry.id ? (language === "zh" ? "删除中…" : "Deleting…") : tx("Delete")}</button></div>)}</div>}
          </section>
        </div>
      )}
    </div>
  );
}
