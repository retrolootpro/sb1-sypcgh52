'use client';

import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useAuth } from '@/lib/auth-context';
import { toast } from 'sonner';
import { createEbayListing, getActiveEmployees, type Employee } from '@/lib/api-services';

type CreateEbayListingDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
  itemId: string;
  itemName: string;
};

export function CreateEbayListingDialog({
  open,
  onOpenChange,
  onSuccess,
  itemId,
  itemName,
}: CreateEbayListingDialogProps) {
  const { user } = useAuth();
  const [loading, setLoading] = useState(false);
  const [listedPrice, setListedPrice] = useState('');
  const [listingUrl, setListingUrl] = useState('');
  const [listingId, setListingId] = useState('');
  const [employeeId, setEmployeeId] = useState<string>('');
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [status, setStatus] = useState<'draft' | 'active'>('draft');

  useEffect(() => {
    const loadEmployees = async () => {
      try {
        const emps = await getActiveEmployees();
        setEmployees(emps);
      } catch (error) {
        console.error('Error loading employees:', error);
      }
    };

    if (open) {
      loadEmployees();
    }
  }, [open]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      await createEbayListing({
        item_id: itemId,
        employee_id: employeeId || undefined,
        listing_url: listingUrl,
        listing_id: listingId,
        listed_price: parseFloat(listedPrice) || 0,
        status,
        listed_at: status === 'active' ? new Date().toISOString() : undefined,
      });

      toast.success('eBay listing created successfully!');
      setListedPrice('');
      setListingUrl('');
      setListingId('');
      setEmployeeId('');
      setStatus('draft');
      onOpenChange(false);
      onSuccess();
    } catch (error: any) {
      toast.error(error.message || 'Failed to create eBay listing');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px] bg-card border-white/10">
        <DialogHeader>
          <DialogTitle>Create eBay Listing</DialogTitle>
          <DialogDescription>
            Create an eBay listing for {itemName}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit}>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="employee">Assign Employee (Optional)</Label>
              <Select value={employeeId} onValueChange={setEmployeeId}>
                <SelectTrigger className="bg-secondary/50">
                  <SelectValue placeholder="Select an employee" />
                </SelectTrigger>
                <SelectContent>
                  {employees.map((employee) => (
                    <SelectItem key={employee.id} value={employee.id}>
                      {employee.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="price">Listed Price</Label>
              <Input
                id="price"
                type="number"
                step="0.01"
                placeholder="0.00"
                value={listedPrice}
                onChange={(e) => setListedPrice(e.target.value)}
                required
                className="bg-secondary/50"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="listing-id">eBay Listing ID (Optional)</Label>
              <Input
                id="listing-id"
                placeholder="e.g., 123456789"
                value={listingId}
                onChange={(e) => setListingId(e.target.value)}
                className="bg-secondary/50"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="listing-url">eBay Listing URL (Optional)</Label>
              <Input
                id="listing-url"
                type="url"
                placeholder="https://www.ebay.com/itm/..."
                value={listingUrl}
                onChange={(e) => setListingUrl(e.target.value)}
                className="bg-secondary/50"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="status">Status</Label>
              <Select value={status} onValueChange={(val) => setStatus(val as 'draft' | 'active')}>
                <SelectTrigger className="bg-secondary/50">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="draft">Draft</SelectItem>
                  <SelectItem value="active">Active</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={loading}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={loading}>
              {loading ? 'Creating...' : 'Create Listing'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
