import {
  formatRetailCnyKpi as sharedFormatRetailCnyKpi,
  formatRetailLitersKpi as sharedFormatRetailLitersKpi,
  formatRetailLitersKpiParts as sharedFormatRetailLitersKpiParts,
  formatRetailSomKpi as sharedFormatRetailSomKpi,
  formatRetailSomKpiParts as sharedFormatRetailSomKpiParts,
  formatRetailTons as sharedFormatRetailTons,
  formatRetailTonsKpi as sharedFormatRetailTonsKpi,
  numericMetric as sharedNumericMetric,
  retailCnyAmountOf as sharedRetailCnyAmountOf,
  retailTonsOf as sharedRetailTonsOf,
} from '@shared/retail-core';

export function numericMetric(value: unknown) {
  return sharedNumericMetric(value);
}

export function retailTonsOf(item: unknown) {
  return sharedRetailTonsOf(item);
}

export function retailCnyAmountOf(item: unknown) {
  return sharedRetailCnyAmountOf(item);
}

export function formatRetailTons(value: unknown, digits = 3, language?: string) {
  return sharedFormatRetailTons(value, digits, language);
}

export function formatRetailLitersKpi(value: unknown, language?: string) {
  return sharedFormatRetailLitersKpi(value, language);
}

export function formatRetailLitersKpiParts(value: unknown, language?: string) {
  return sharedFormatRetailLitersKpiParts(value, language);
}

export function formatRetailSomKpi(value: unknown, language?: string) {
  return sharedFormatRetailSomKpi(value, language);
}

export function formatRetailSomKpiParts(value: unknown, language?: string) {
  return sharedFormatRetailSomKpiParts(value, language);
}

export function formatRetailCnyKpi(value: unknown, language?: string) {
  return sharedFormatRetailCnyKpi(value, language);
}

export function formatRetailTonsKpi(value: unknown, language?: string) {
  return sharedFormatRetailTonsKpi(value, language);
}
