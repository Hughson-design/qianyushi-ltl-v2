export type SmartFreightItem = {
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

export type SmartQuoteResult = {
  originAddress: string;
  originZip: string;
  destinationAddress: string;
  destinationZip: string;
  hasDeclaredDeliveryType: boolean;
  items: SmartFreightItem[];
  services: string[];
  conversions: string[];
  missing: string[];
};

type TextMatch = RegExpMatchArray & { index: number };

const originMarker = /(?:(?:商业|家庭|住宅|私人地址)(?:有|无)卸货平台|(?:commercial|residential)\s+(?:with|without)\s+(?:a\s+)?loading\s+dock\s*)?(?:发货人?(?:地址)?|提货(?:地址|地)?|取货(?:地址|地)?|sender(?:\s*address)?|ship\s*from|pickup(?:\s*address)?)[：:]/i;
const destinationMarker = /(?:(?:商业|家庭|住宅|私人地址)(?:有|无)卸货平台|(?:commercial|residential)\s+(?:with|without)\s+(?:a\s+)?loading\s+dock\s*)?(?:收货人?(?:地址)?|派送(?:地址|地)?|送货(?:地址|地)?|receiver(?:\s*address)?|consignee(?:\s*address)?|ship\s*to|deliver(?:y)?(?:\s*address)?)[：:]/i;
const dimensionsPattern = /(\d+(?:\.\d+)?)\s*[x×*＊]\s*(\d+(?:\.\d+)?)\s*[x×*＊]\s*(\d+(?:\.\d+)?)\s*(厘米|公分|公尺|英寸|米|(?:cm|meters?|metres?|m|inches|inch|in)\b|")?/i;
const pickupAddressPrefix = /^\s*(?:发货人?地址|提货地址|取货地址)\s*[：:]?\s*/;
const deliveryAddressPrefix = /^\s*(?:收货人?地址|派送地址|送货地址)\s*[：:]?\s*/;
const deliveryServiceLine = /^(?:(?:商业|住宅|家庭|私人地址)(?:地址|派送|送货)?|(?:电话)?预约(?:派送|送货)?|(?:派送|送货)(?:要求|服务)?[：:]?|(?:需(?:要)?|派送|送货)?(?:尾板|尾门)(?:车|服务)?|(?:commercial|residential)(?:\s+(?:address|delivery))?|delivery\s+(?:services?|requirements?)[:：]?|appointment(?:\s+delivery)?|lift\s*gate(?:\s+at\s+delivery)?|[\s,，、;；])+$/i;
const commercialDelivery = /商业|\bcommercial\b(?=\s*(?:[,，;；]|$)|\s+(?:address|delivery|location|with|without|no)\b)/i;
export const missingDimensionUnit = "dimension unit (m, cm, or in)";
const weightPattern = /(\d+(?:\.\d+)?)\s*(kg|公斤|kgs?|lbs?|磅)/gi;
const addressDescriptorPattern = /商业|家庭|住宅|私人地址|有卸货平台|无卸货平台|尾门|尾板|预约|有限地点|限制地点|commercial|residential|\bhome\b|with(?:\s+a)?\s+loading\s+dock|without(?:\s+a)?\s+loading\s+dock|no\s+(?:loading\s+)?dock|loading\s+dock|lift\s*gate|liftgate|appointment|limited\s*access/gi;

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

function roundUp(value: number) {
  return String(Math.ceil(value));
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
  const residential = /家庭|住宅|私人地址|residential|\bhome\b/i;
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

function freightItemFromLine(line: string, conversions: string[], missing: string[]): SmartFreightItem | null {
  const dimensions = line.match(dimensionsPattern);
  const trailingWeight = dimensions ? line.slice((dimensions.index ?? 0) + dimensions[0].trimEnd().length).match(/^[\s,，;；]+(\d+(?:\.\d+)?)\s*$/) : null;
  const weight = line.match(new RegExp(weightPattern.source, "i")) ?? trailingWeight;
  if (!dimensions && !weight) return null;

  const dimensionUnit = dimensions?.[4]?.toLowerCase();
  const rawLength = Number(dimensions?.[1] ?? 0);
  const rawWidth = Number(dimensions?.[2] ?? 0);
  const rawHeight = Number(dimensions?.[3] ?? 0);
  const weightUnit = weight?.[2]?.toLowerCase() ?? "lb";
  const isKilograms = /kg|公斤/.test(weightUnit);
  const rawWeight = Number(weight?.[1] ?? 0);
  const needsUnit = Boolean(dimensions && !dimensionUnit && [rawLength, rawWidth, rawHeight].some((size) => size < 10 && !Number.isInteger(size)));
  if (needsUnit && !missing.includes(missingDimensionUnit)) missing.push(missingDimensionUnit);
  const centimetersPerUnit = /^(?:米|公尺|m|meters?|metres?)$/.test(dimensionUnit ?? "") ? 100
    : /^(?:cm|厘米|公分)$/.test(dimensionUnit ?? "") ? 1 : 0;
  const inchesPerUnit = centimetersPerUnit ? centimetersPerUnit / 2.54 : 1;
  const convertedLength = rawLength * inchesPerUnit;
  const convertedWidth = rawWidth * inchesPerUnit;
  const convertedHeight = rawHeight * inchesPerUnit;
  const convertedWeight = isKilograms ? rawWeight * 2.2046226218 : rawWeight;
  const pallets = line.match(/(\d+)\s*(?:托盘|托|pallets?|skids?)/i)?.[1] ?? line.match(/(?:数量|qty|quantity)[：:]?\s*(\d+)/i)?.[1] ?? "1";
  const totalWeightProvided = /总重量|total\s*weight/i.test(line);
  const unitWeight = totalWeightProvided && Number(pallets) > 0 ? convertedWeight / Number(pallets) : convertedWeight;
  const commodity = fieldValue(line, "英文品名|品名|commodity|description").split(/[,，;；]/)[0].trim();
  const declaredValue = line.match(/(?:货值|declared\s*value|value)[：:]?\s*\$?\s*(\d+(?:\.\d+)?)/i)?.[1] ?? "";
  const hazmat = /危险品|hazmat|hazardous/i.test(line) && !/非危险品|不是危险品|non[-\s]?hazmat/i.test(line);
  const stackable = !/不可堆叠|不能堆叠|non[-\s]?stackable|do\s*not\s*stack/i.test(line);

  if (centimetersPerUnit) conversions.push(`${rawLength}×${rawWidth}×${rawHeight} ${centimetersPerUnit === 100 ? "m" : "cm"} → ${roundUp(convertedLength)}×${roundUp(convertedWidth)}×${roundUp(convertedHeight)} in`);
  if (isKilograms && weight) conversions.push(`${rawWeight} kg → ${roundUp(convertedWeight)} lb`);
  if (dimensions && !dimensionUnit && !needsUnit && !conversions.includes("Dimensions without units use inches (in).")) {
    conversions.push("Dimensions without units use inches (in).");
  }
  if (weight === trailingWeight && trailingWeight && !conversions.includes("Weights without units use pounds (lb).")) {
    conversions.push("Weights without units use pounds (lb).");
  }

  return {
    packaging: /(?:木箱|crate)/i.test(line) ? "Crate" : /(?:纸箱|carton)/i.test(line) ? "Carton" : /(?:捆|bale)/i.test(line) ? "Bale" : /(?:卷|roll)/i.test(line) ? "Roll" : /(?:散件|loose)/i.test(line) ? "Loose" : "Pallet",
    stackable,
    pallets,
    pieces: line.match(/(\d+)\s*(?:件|pieces?\b|pcs\b)/i)?.[1] ?? pallets,
    nmfc: line.match(/\bNMFC\s*(?:#|:|：)?\s*(\d+(?:-\d+)?)/i)?.[1] ?? "",
    length: needsUnit ? "" : roundUp(convertedLength),
    width: needsUnit ? "" : roundUp(convertedWidth),
    height: needsUnit ? "" : roundUp(convertedHeight),
    unitWeight: roundUp(unitWeight),
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
  const lines = input.replace(/\r\n?/g, "\n").split("\n").map((line) => line.replace(/[\t]+/g, " ").replace(/\\\s*$/, "").trim()).filter(Boolean);
  const originLine = lines[0] ?? "";
  const destinationLine = lines[1] ?? "";
  const deliveryNotes = lines.slice(2).filter((line) => deliveryServiceLine.test(line));
  const deliveryText = [destinationLine, ...deliveryNotes].join(", ");
  const cargoLines = lines.slice(2).filter((line) => !deliveryServiceLine.test(line));
  const originAddress = stripAddressLine(originLine.replace(pickupAddressPrefix, ""), originMarker);
  const destinationAddress = stripAddressLine(destinationLine.replace(deliveryAddressPrefix, ""), destinationMarker);
  const conversions: string[] = [];
  const missing: string[] = [];
  if (!originAddress || !zipFrom(originAddress)) missing.push("pickup address and ZIP code");
  if (!destinationAddress || !zipFrom(destinationAddress)) missing.push("delivery address and ZIP code");
  const items = cargoLines.map((line) => freightItemFromLine(line, conversions, missing)).filter((item): item is SmartFreightItem => item !== null);
  if (items.length === 0 || items.some((item) => item.length === "0" || item.width === "0" || item.height === "0" || !Number(item.unitWeight))) missing.push("dimensions and weight");
  if (items.length && items.length !== cargoLines.length) missing.push("unrecognized freight or service line");

  const services = detectServices(originLine, deliveryText, cargoLines.join(" "));
  return {
    originAddress,
    originZip: zipFrom(originAddress),
    destinationAddress,
    destinationZip: zipFrom(destinationAddress),
    items,
    hasDeclaredDeliveryType: services.includes("Residential delivery") || commercialDelivery.test(deliveryText),
    services,
    conversions,
    missing,
  };
}
