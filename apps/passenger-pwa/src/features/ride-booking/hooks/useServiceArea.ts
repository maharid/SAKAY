import { useEffect, useState } from "react";

import { fetchServiceArea, type ServiceArea } from "../../../services/serviceAreaService";

/** The active service area (null until it has been read, or when it cannot be: the database still enforces it). */
export const useServiceArea = (): ServiceArea | null => {
  const [area, setArea] = useState<ServiceArea | null>(null);

  useEffect(() => {
    let stopped = false;
    fetchServiceArea().then((answer) => {
      if (!stopped) setArea(answer);
    });
    return () => {
      stopped = true;
    };
  }, []);

  return area;
};
