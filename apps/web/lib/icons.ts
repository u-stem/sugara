import type { ScheduleCategory, TransportMethod } from "@sugara/shared";
import {
  Bed,
  Bike,
  Bus,
  Camera,
  Car,
  Footprints,
  MapPin,
  Plane,
  Ticket,
  Train,
  TrainFront,
  Utensils,
} from "lucide-react";

export const CATEGORY_ICONS: Record<ScheduleCategory, typeof Camera> = {
  sightseeing: Camera,
  restaurant: Utensils,
  hotel: Bed,
  transport: Train,
  activity: Ticket,
  other: MapPin,
};

export const TRANSPORT_ICONS: Record<TransportMethod, typeof Train> = {
  train: Train,
  shinkansen: TrainFront,
  bus: Bus,
  taxi: Car,
  walk: Footprints,
  car: Car,
  airplane: Plane,
  bicycle: Bike,
};
