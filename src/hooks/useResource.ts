import { useCallback, useEffect, useRef, useState } from "react";
export function useResource<T>(load: () => Promise<T>, key: string) {
  const loader = useRef(load);
  loader.current = load;
  const [data, setData] = useState<T>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [version, setVersion] = useState(0);
  const refresh = useCallback(() => setVersion((v) => v + 1), []);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    setData(undefined);
    void loader
      .current()
      .then((value) => {
        if (active) setData(value);
      })
      .catch((e: unknown) => {
        if (active)
          setError(
            e instanceof Error ? e.message : "Podaci trenutačno nisu dostupni.",
          );
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [key, version]);
  return { data, loading, error, refresh };
}
