import { useEffect, useState } from 'react';
import {
  loadDeliveryPhotos,
  subscribeDeliveryPhotos,
  type DeliveryPhotoRecord,
} from '@/src/utils/deliveryPhotos';

/** Live list of local proof photos attached to one stop. */
export function useDeliveryPhotos(
  stopId?: string | null
): DeliveryPhotoRecord[] {
  const [photos, setPhotos] = useState<DeliveryPhotoRecord[]>([]);

  useEffect(() => {
    let alive = true;

    const load = async () => {
      if (!stopId) {
        if (alive) setPhotos([]);
        return;
      }
      const all = await loadDeliveryPhotos();
      if (!alive) return;
      setPhotos(
        all
          .filter((record) => record.stopId === stopId)
          .sort((a, b) => a.createdAt - b.createdAt)
      );
    };

    void load();
    const unsubscribe = subscribeDeliveryPhotos(() => void load());
    return () => {
      alive = false;
      unsubscribe();
    };
  }, [stopId]);

  return photos;
}
