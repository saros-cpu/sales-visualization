import { useQuery, useMutation, UseQueryOptions, UseMutationOptions } from '@tanstack/react-query';
import { QueryKey } from '@tanstack/react-query';

export function useApiQuery<T>(
  queryKey: QueryKey,
  fetcher: () => Promise<T>,
  options?: Omit<UseQueryOptions<T, Error>, 'queryKey' | 'queryFn'>
) {
  return useQuery<T, Error>({
    queryKey,
    queryFn: fetcher,
    ...options,
  });
}

export function useApiMutation<TVars, TData = unknown>(
  mutationFn: (vars: TVars) => Promise<TData>,
  options?: Omit<UseMutationOptions<TData, Error, TVars>, 'mutationFn'>
) {
  return useMutation<TData, Error, TVars>({
    mutationFn,
    ...options,
  });
}
