export type SmartFreightItem = {
  packaging: string;
  stackable: boolean;
  pallets: string;
  length: string;
  width: string;
  height: string;
  unitWeight: string;
  hazmat: boolean;
  commodity: string;
  declaredValue: string;
};

export type SmartQuoteResult = {
  originAddress: string;
  originZip: string;
  destinationAddress: string;
  destinationZip: string;
  items: SmartFreightItem[];
  services: string[];
  conversions: string[];
  missing: string[];
};

type TextMatch = RegExpMatchArray & { index: number };

const originMarker = /(?:(?:商业|家庭|住宅)(?:有|无)卸货平台|(?:commercial|residential)\s+(?:with|without)\s+(?:a\s+)?loading\s+dock\s*)?(?:发货人?(?:地址)?|提货(?:地址|地)?|取货(?:地址|地)?|sender(?:\s*address)?|ship\s*from|pickup(?:\s*address)?)[：:]/i;
const destinationMarker = /(?:(?:商业|家庭|住宅)(?:有|无)卸货平台|(?:commercial|residential)\s+(?:with|without)\s+(?:a\s+)?loading\s+dock\s*)?(?:收货人?(?:地址)?|派送(?:地址|地)?|送货(?:地址|地)?|receiver(?:\s*address)?|consignee(?:\s*address)?|ship\s*to|deliver(?:y)?(?:\s*address)?)[：:]/i;
const dimensionsPattern = /(\d+(?:\.\d+)?)\s*[x×*]\s*(\d+(?:\.\d+)?)\s*[x×*]\s*(\d+(?:\.\d+)?)\s*(cm|厘米|inches?|inch|in)?/gi;
const weightPattern = /(\d+(?:\.\d+)?)\s*(kg|公斤|kgs?|lbs?|磅)/gi;
const addressDescriptorPattern = /商业|家庭|住宅|有卸货平台|无卸货平台|尾门|尾板|预约|有限地点|限制地点|commercial|residential|\bhome\b|with(?:\s+a)?\s+loading\s+dock|without(?:\s+a)?\s+loading\s+dock|no\s+(?:loading\s+)?dock|loading\s+dock|lift\s*gate|liftgate|appointment|limited\s*access/gi;

function matchWithIndex(text: string, pattern: RegExp): TextMatch | null {
  const match = text.match(pattern);
  return match && typeof match.index === "number" ? (match as TextMatch) : null;
}

function cleanSegment(value: string) {
  return value.replace(/^[\s,，;；:：-]+|[\s,，;；:：-]+$/g, "").trim();
}

function zipFrom(address: string) {
  const matches = address.match(/\b\d{5}(?:-\d{4})?\b/g);
  return matches?.at(-1) ?? "";
}

function rounded(value: number) {
  return String(Math.round(value));
}

function fieldValue(text: string, names: string) {
  const pattern = new RegExp(`(?:${names})[：:]\\s*([\\s\\S]*?)(?=(?:尺寸|重量|品名|英文品名|货物|货值|增值服务|附加服务|dimensions?|weight|commodity|value|services?)[：:]|$)`, "i");
  return cleanSegment(text.match(pattern)?.[1] ?? "");
}

function stripAddressLine(line: string, marker: RegExp) {
  const marked = matchWithIndex(line, marker);
  const address = marked ? line.slice(marked.index + marked[0].length) : line;
  return cleanSegment(address.replace(addressDescriptorPattern, " ").replace(/\s*[,，]\s*(?=[,，]|$)/g, "").replace(/\s{2,}/g, " "));
}

function detectServices(originLine: string, destinationLine: string, cargoText: string) {
  const services = new Set<string>();
  const residential = /家庭|住宅|residential|\bhome\b/i;
  const liftgate = /无卸货平台|无装卸平台|尾门|尾板|lift\s*gate|liftgate|without(?:\s+a)?\s+loading\s+dock|no\s+(?:loading\s+)?dock/i;
  if (residential.test(originLine)) services.add("Residential pickup");
  if (residential.test(destinationLine)) services.add("Residential delivery");
  if (liftgate.test(originLine)) services.add("Liftgate at pickup");
  if (liftgate.test(destinationLine)) services.add("Liftgate at delivery");
  if (/预约|appointment/i.test(destinationLine)) services.add("Appointment delivery");
  if (/超长|overlength|over[-\s]?length/i.test(cargoText)) services.add("Overlength freight");
  if (/有限地点|限制地点|limited\s*access/i.test(`${originLine} ${destinationLine}`)) services.add("Limited access");

  return [...services];
}

function freightItemFromLine(line: string, conversions: string[]): SmartFreightItem | null {
  const dimensions = line.match(new RegExp(dimensionsPattern.source, "i"));
  const weight = line.match(new RegExp(weightPattern.source, "i"));
  if (!dimensions && !weight) return null;

  const dimensionUnit = dimensions?.[4]?.toLowerCase() ?? "in";
  const isCentimeters = dimensionUnit === "cm" || dimensionUnit === "厘米";
  const rawLength = Number(dimensions?.[1] ?? 0);
  const rawWidth = Number(dimensions?.[2] ?? 0);
  const rawHeight = Number(dimensions?.[3] ?? 0);
  const weightUnit = weight?.[2]?.toLowerCase() ?? "lb";
  const isKilograms = /kg|公斤/.test(weightUnit);
  const rawWeight = Number(weight?.[1] ?? 0);
  const convertedLength = isCentimeters ? rawLength / 2.54 : rawLength;
  const convertedWidth = isCentimeters ? rawWidth / 2.54 : rawWidth;
  const convertedHeight = isCentimeters ? rawHeight / 2.54 : rawHeight;
  const convertedWeight = isKilograms ? rawWeight * 2.2046226218 : rawWeight;
  const pallets = line.match(/(\d+)\s*(?:托盘|托|pallets?|skids?)/i)?.[1] ?? line.match(/(?:数量|qty|quantity)[：:]?\s*(\d+)/i)?.[1] ?? "1";
  const totalWeightProvided = /总重量|total\s*weight/i.test(line);
  const unitWeight = totalWeightProvided && Number(pallets) > 0 ? convertedWeight / Number(pallets) : convertedWeight;
  const commodity = fieldValue(line, "英文品名|品名|commodity|description").split(/[,，;；]/)[0].trim();
  const declaredValue = line.match(/(?:货值|declared\s*value|value)[：:]?\s*\$?\s*(\d+(?:\.\d+)?)/i)?.[1] ?? "";
  const hazmat = /危险品|hazmat|hazardous/i.test(line) && !/非危险品|不是危险品|non[-\s]?hazmat/i.test(line);
  const stackable = !/不可堆叠|不能堆叠|non[-\s]?stackable|do\s*not\s*stack/i.test(line);

  if (isCentimeters && dimensions) conversions.push(`${rawLength}×${rawWidth}×${rawHeight} cm → ${rounded(convertedLength)}×${rounded(convertedWidth)}×${rounded(convertedHeight)} in`);
  if (isKilograms && weight) conversions.push(`${rawWeight} kg → ${rounded(convertedWeight)} lb`);

  return {
    packaging: /(?:木箱|crate)/i.test(line) ? "Crate" : /(?:纸箱|carton)/i.test(line) ? "Carton" : /(?:捆|bale)/i.test(line) ? "Bale" : /(?:卷|roll)/i.test(line) ? "Roll" : /(?:散件|loose)/i.test(line) ? "Loose" : "Pallet",
    stackable,
    pallets,
    length: rounded(convertedLength),
    width: rounded(convertedWidth),
    height: rounded(convertedHeight),
    unitWeight: rounded(unitWeight),
    hazmat,
    commodity,
    declaredValue,
  };
}

export function calculateDensityClass(length: number, width: number, height: number, unitWeight: number) {
  if (![length, width, height, unitWeight].every((value) => Number.isFinite(value) && value > 0)) return "—";
  const cubicFeet = (length * width * height) / 1728;
  const density = unitWeight / cubicFeet;
  if (density < 1) return "400";
  if (density < 2) return "300";
  if (density < 4) return "250";
  if (density < 6) return "175";
  if (density < 8) return "125";
  if (density < 10) return "100";
  if (density < 12) return "92.5";
  if (density < 15) return "85";
  if (density < 22.5) return "70";
  if (density < 30) return "65";
  if (density < 35) return "60";
  if (density < 50) return "55";
  return "50";
}

export function parseSmartQuote(input: string): SmartQuoteResult {
  const lines = input.replace(/\r\n?/g, "\n").split("\n").map((line) => line.replace(/[\t]+/g, " ").trim()).filter(Boolean);
  const originLine = lines[0] ?? "";
  const destinationLine = lines[1] ?? "";
  const cargoLines = lines.slice(2);
  const originAddress = stripAddressLine(originLine, originMarker);
  const destinationAddress = stripAddressLine(destinationLine, destinationMarker);
  const conversions: string[] = [];
  const items = cargoLines.map((line) => freightItemFromLine(line, conversions)).filter((item): item is SmartFreightItem => item !== null);

  const missing: string[] = [];
  if (!originAddress || !zipFrom(originAddress)) missing.push("pickup address and ZIP code");
  if (!destinationAddress || !zipFrom(destinationAddress)) missing.push("delivery address and ZIP code");
  if (items.length === 0 || items.some((item) => !Number(item.length) || !Number(item.width) || !Number(item.height) || !Number(item.unitWeight))) missing.push("dimensions and weight");

  return {
    originAddress,
    originZip: zipFrom(originAddress),
    destinationAddress,
    destinationZip: zipFrom(destinationAddress),
    items,
    services: detectServices(originLine, destinationLine, cargoLines.join(" ")),
    conversions,
    missing,
  };
}
